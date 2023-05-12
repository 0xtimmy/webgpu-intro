<template>
  <main>
    <div>
      <canvas width="512" height="512" ref="canvas" v-if="supported"></canvas>
      <div class="webgpu-warning" v-else>WebGPU Not supported</div>
    </div>
    <div>
      <h2>Notes</h2>
      <p>
        Grid Size: 256 x 256 <br>
        Refresh Rate: 60fps <br>
      </p>
    </div>
  </main>
</template>

<script lang="js">
import { defineComponent } from "vue";

export default defineComponent({
  name: "Home",
  data() {
    return {
      supported: false,
      adapter: null,
      device: null,
      context: null,
      canvasFormat: null,
    }
  },
  mounted: async function() {
    await this.initgpu();
    await this.drawsquares();
  },
  methods: {
    drawsquares: async function() {
      const GRID_SIZE = 256;
      const UPDATE_INTERVAL =  1000 / 60; //ms
      const WORKGROUP_SIZE = 8;
      let step = 0;

      // Vertices

      const vertices = new Float32Array([
      //   X,    Y
        -0.8, -0.8, // Triangle 1
         0.8, -0.8,
         0.8,  0.8,

        -0.8, -0.8, // Triangle 2
         0.8,  0.8,
        -0.8,  0.8,
      ]);
      const vertexBuffer = this.device.createBuffer({
        label: "Cell vertices",
        size: vertices.byteLength,
        usage: window.GPUBufferUsage.VERTEX | window.GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(vertexBuffer, 0, vertices);

      // Layouts

      const vertexBufferLayout = {
        arrayStride: 8,
        attributes: [{
          format: "float32x2",
          offset: 0,
          shaderLocation: 0, // Position. Matches @location(0) in the @vertex shader.
        }],
      };

      const bindGroupLayout = this.device.createBindGroupLayout({
        label: "Cell Bind Group Layout",
        entries: [{
          binding: 0,
          visibility: window.GPUShaderStage.VERTEX | window.GPUShaderStage.FRAGMENT | window.GPUShaderStage.COMPUTE,
          buffer: {}
        }, {
          binding: 1,
          visibility: window.GPUShaderStage.VERTEX | window.GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" }
        }, {
          binding: 2,
          visibility: window.GPUShaderStage.COMPUTE,
          buffer: { type: "storage" }
        }]
      });

      const pipelineLayout = this.device.createPipelineLayout({
        label: "Cell Pipeline Layout",
        bindGroupLayouts: [ bindGroupLayout ]
      });

      // Shaders

      const cellShaderModule = this.device.createShaderModule({
        label: "Cell shader",
        code: `
          struct VertexInput {
            @location(0) pos: vec2f,
            @builtin(instance_index) instance: u32,
          };

          struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) cell: vec2f,
          };

          @group(0) @binding(0) var<uniform> grid: vec2f;
          @group(0) @binding(1) var<storage> cellState: array<u32>;
            
          @vertex
          fn vertexMain(input: VertexInput )
            -> VertexOutput {
              let i = f32(input.instance);
              let cell = vec2f(i % grid.x, floor(i / grid.y));
              let state = f32(cellState[input.instance]);

              
              let cellOffset = cell / grid * 2;
              let gridPos = ((input.pos*state + 1) / grid - 1 + cellOffset);

              var output: VertexOutput;
              output.pos = vec4f(gridPos, 0, 1);
              output.cell = cell;
              return output;
          }

          @fragment
          fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
            let c = input.cell / grid;
            return vec4f(c, 1.0 - c.x, 1);
          }
        `
      });

      const simulationShaderModule = this.device.createShaderModule({
        label: "sim",
        code: `
          @group(0) @binding(0) var<uniform> grid: vec2f;
          
          @group(0) @binding(1) var<storage> cellStateIn: array<u32>;
          @group(0) @binding(2) var<storage, read_write> cellStateOut: array<u32>; 

          fn cellIndex(cell: vec2u) -> u32 {
            return (cell.y % u32(grid.y)) * u32(grid.x) + (cell.x % u32(grid.x));
          }

          fn cellActive(x: u32, y: u32) -> u32 {
            return cellStateIn[cellIndex(vec2(x, y))];
          }

          fn getActive(cell: vec3u) -> u32 {
            return cellActive(cell.x+1, cell.y+1) +
                    cellActive(cell.x+1, cell.y) +
                    cellActive(cell.x+1, cell.y-1) +
                    cellActive(cell.x, cell.y-1) +
                    cellActive(cell.x-1, cell.y-1) +
                    cellActive(cell.x-1, cell.y) +
                    cellActive(cell.x-1, cell.y+1) +
                    cellActive(cell.x, cell.y+1);
          }

          @compute
          @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
          fn computeMain(@builtin(global_invocation_id) cell: vec3u) {
            let activeNeighbors = getActive(cell);
            let i = cellIndex(cell.xy);

            // Conway's game of life rules:
            switch activeNeighbors {
              case 2: {
                cellStateOut[i] = cellStateIn[i];
              }
              case 3: {
                cellStateOut[i] = 1;
              }
              default: {
                cellStateOut[i] = 0;
              }
            }
          }
        `
      })

      // Uniforms

      const uniformArray = new Float32Array([GRID_SIZE, GRID_SIZE]);
      const uniformBuffer = this.device.createBuffer({
        label: "Grid Uniforms",
        size: uniformArray.byteLength,
        usage: window.GPUBufferUsage.UNIFORM | window.GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

      // Cell State
      const cellStateArray = new Uint32Array(GRID_SIZE * GRID_SIZE);
      const cellStateStorageBuffers = [
        this.device.createBuffer({
          label: "Cell State A",
          size: cellStateArray.byteLength,
          usage: window.GPUBufferUsage.STORAGE | window.GPUBufferUsage.COPY_DST,
        }),
        this.device.createBuffer({
          label: "Cell State B",
          size: cellStateArray.byteLength,
          usage: window.GPUBufferUsage.STORAGE | window.GPUBufferUsage.COPY_DST,
        })
      ]

      for(let i = 0; i < cellStateArray.length; ++i) {
        cellStateArray[i] = Math.random() > 0.6 ? 1 : 0;
      }
      this.device.queue.writeBuffer(cellStateStorageBuffers[0], 0, cellStateArray);

      // Pipelines

      const cellPipeline = this.device.createRenderPipeline({
        label: "Cell pipeline",
        layout: pipelineLayout,
        vertex: {
          module: cellShaderModule,
          entryPoint: "vertexMain",
          buffers: [vertexBufferLayout]
        },
        fragment: {
          module: cellShaderModule,
          entryPoint: "fragmentMain",
          targets: [{
            format: this.canvasFormat
          }]
        }
      });

      const simulationPipeline = this.device.createComputePipeline({
        label: "Simulation Pipeline",
        layout: pipelineLayout,
        compute: {
          module: simulationShaderModule,
          entryPoint: "computeMain"
        }
      })

      // Bind Group

      const bindGroups = [
        this.device.createBindGroup({
          label: "Cell Renderer Bind Group A",
          layout: bindGroupLayout,
          entries: [{
            binding: 0,
            resource: { buffer: uniformBuffer }
          }, {
            binding: 1,
            resource: { buffer: cellStateStorageBuffers[0] }
          }, {
            binding: 2,
            resource: { buffer: cellStateStorageBuffers[1] }
          }],
        }),
        this.device.createBindGroup({
          label: "Cell Renderer Bind Group B",
          layout: bindGroupLayout,
          entries: [{
            binding: 0,
            resource: { buffer: uniformBuffer }
          }, {
            binding: 1,
            resource: { buffer: cellStateStorageBuffers[1] }
          }, {
            binding: 2,
            resource: { buffer: cellStateStorageBuffers[0] }
          }],
        }),
      ];

      const render = () => {
        const encoder = this.device.createCommandEncoder();
        const computePass = encoder.beginComputePass();

        computePass.setPipeline(simulationPipeline);
        computePass.setBindGroup(0, bindGroups[step % 2]);

        const workgroupCount = Math.ceil(GRID_SIZE / WORKGROUP_SIZE);
        computePass.dispatchWorkgroups(workgroupCount, workgroupCount);


        computePass.end();
        step++;
        
        const renderPass = encoder.beginRenderPass({
            colorAttachments: [{
                    view: this.context.getCurrentTexture().createView(),
                    loadOp: "clear",
                    clearValue: { r: .05, g: 0, b: .1, a: 1.0 },
                    storeOp: "store",
                }]
        });

        renderPass.setPipeline(cellPipeline);
        renderPass.setVertexBuffer(0, vertexBuffer);
        renderPass.setBindGroup(0, bindGroups[step % 2]);
        renderPass.draw(vertices.length / 2, GRID_SIZE * GRID_SIZE);

        renderPass.end();

        this.device.queue.submit([encoder.finish()]);
      }

      setInterval(() => {
        render();
      }, UPDATE_INTERVAL);
      return;

    },
    initgpu: async function() {
      
      if(typeof(navigator.gpu) == 'undefined') {
        console.error("‼️ WebGPU not supported in this brower");
        this.supported = false;
        return;
      }

      console.log("✅ WebGPU is supported");
      this.supported = true;

      this.adapter = await navigator.gpu.requestAdapter();
      if (!this.adapter) {
        console.error("‼️ Could not find gpu adapter");
        return;
      }
      console.log("✅ Found adapter");

      this.device = await this.adapter.requestDevice();

      // Canvas Config
      this.context = this.$refs['canvas'].getContext("webgpu");
      this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({
          device: this.device,
          format: this.canvasFormat,
      });

      return;
    }
  }
});
</script>

<style scoped>
  canvas {
    border: solid 10px var(--type-color);
  }

  .webgpu-warning {
    background-color: var(--warning-color);
    font-weight: bold;
    padding: 1rem 2rem;
    font-size: 1rem
  }
</style>