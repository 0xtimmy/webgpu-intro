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
    name: "PerlinNoise",
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
    await this.generatenoise();
  },
  methods: {
    generatenoise: async function() {
      const STARTING_RESOLUTION = 8;
      const GENERATE_PASSES = 4;
      const TOTAL_RESOLUTION = 57;
      const POINTS = 29;
      const RANDOM_SIZE = 512;
      const WORKGROUP_SIZE = 1;

      /*
       * generate a random array to hash through (rotate the array a random amount after every pass)
       * load a starting 8
       * run four passes
       * if it has a value; keep the value
       * if it is between two, average the two and add random * half the distance
       * else average the four around it and add half * the max - min
       * adjust a resolution parameter
       * repeat
      */

      // an elevation is a struct { vec2f: pos, f: elevation }

      // Buffers

      // Grid Buffer
      const gridArray = new Float32Array([TOTAL_RESOLUTION, TOTAL_RESOLUTION]);
      const gridBuffer = this.device.createBuffer({
        label: "Grid Uniforms",
        size: gridArray.byteLength,
        usage: window.GPUBufferUsage.UNIFORM | window.GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(gridBuffer, 0, gridArray);
      const radixArray = new Uint32Array([4]);
      const radixBuffer = this.device.createBuffer({
        label: "Radix Uniforms",
        size: radixArray.byteLength,
        usage: window.GPUBufferUsage.UNIFORM | window.GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(radixBuffer, 0, radixArray);

      // Vertex Buffer
      const vertices = new Float32Array([
        -0.8, -0.8, // Triangle 1
         0.8, -0.8,
         0.8,  0.8,

        -0.8, -0.8, // Triangle 2
         0.8,  0.8,
        -0.8,  0.8,
      ]);
      const vertexBuffer = this.device.createBuffer({
        label: "Elevation Vertices",
        size: vertices.byteLength,
        usage: window.GPUBufferUsage.UNIFORM | window.GPUBufferUsage.VERTEX | window.GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(vertexBuffer, 0, vertices);

      // Random Number Buffer
      const randoms = new Float32Array(RANDOM_SIZE);
      for(let i = 0; i < randoms.length; i++) {
        randoms[i] = Math.random();
      }
      const randomBuffer = this.device.createBuffer({
        label: "Random Numbers",
        size: randoms.byteLength,
        usage: window.GPUBufferUsage.COMPUTE | window.GPUBufferUsage.COPY_DST
      });
      this.device.queue.writeBuffer(randomBuffer, 0, randoms);
      
      // Elevation Buffer
      const elevations = new Float32Array(TOTAL_RESOLUTION * TOTAL_RESOLUTION);
      for(let i = 0; i < TOTAL_RESOLUTION; i += 8) {
        for(let j = 0; j < TOTAL_RESOLUTION; j += 8) {
          elevations[i*TOTAL_RESOLUTION + j] = Math.random() + 0.001;
        }
      }
      const elevationBuffers = [
        this.device.createBuffer({
          labal: "Elevation Buffer A",
          size: elevations.byteLength,
          usage: window.GPUBufferUsage.COMPUTE | window.GPUBufferUsage.STORAGE | window.GPUBufferUsage.VERTEX | window.GPUBufferUsage.COPY_DST
        }),
        this.device.createBuffer({
          labal: "Elevation Buffer B",
          size: elevations.byteLength,
          usage: window.GPUBufferUsage.COMPUTE | window.GPUBufferUsage.STORAGE | window.GPUBufferUsage.VERTEX | window.GPUBufferUsage.COPY_DST
        })
      ];
      this.device.queue.writeBuffer(elevationBuffers[0], 0, elevations);

      // Layouts
      const vertexBufferLayout = {
        arrayStride: 8,
        attributes: [{
          format: "float32x2",
          offset: 0,
          shaderLocation: 0, // Position, see vertex shader
        }],
      };

      const bindGroupLayout = this.device.createBindGroupLayout({
        label: "Elevation Bind Group Layout",
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
        }, {
          binding: 3,
          visibility: window.GPUShaderStage.VERTEX | window.GPUShaderStage.FRAGMENT | window.GPUShaderStage.COMPUTE,
          buffer: {}
        }]
      });

      const pipelineLayout = this.device.createPipelineLayout({
        label: "Pipeline Layout",
        bindGroupLayouts: [ bindGroupLayout ]
      });

      // Compute

      const elevationComputeModule = this.device.createShaderModule({
        label: "Elevation Compute",
        code: `
          @group(0) @binding(0) var<uniform> grid: vec2f;
          @group(0) @binding(3) var<uniform> radix: u32;

          @group(0) @binding(1) var<storage> elevationIn: array<f32>;
          @group(0) @binding(2) var<storage, read_write> elevationOut: array<f32>;

          fn locIndex(loc: vec2u) -> u32 {
            return ((loc.y * radix) % u32(grid.y)) * u32(grid.x) + ((loc.x * radix) % u32(grid.x));
          }

          @compute
          @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
          fn computeMain(@builtin(global_invocation_id) loc: vec3u) {
            let i = locIndex(loc.xy);
            let interp = (loc.x % 2) + 2 * (loc.y % 2);
            switch interp {
              case 1: {
                let res = (elevationIn[locIndex(vec2u(loc.x - 1, loc.y))] + 
                          elevationIn[locIndex(vec2u(loc.x + 1, loc.y))]) / 2;
                elevationOut[i] = res;
              }
              case 2: {
                let res = (elevationIn[locIndex(vec2u(loc.x, loc.y + 1))] + 
                          elevationIn[locIndex(vec2u(loc.x, loc.y - 1))]) / 2;
                elevationOut[i] = res;
              }
              case 3: {
                let res = (elevationIn[locIndex(vec2u(loc.x + 1, loc.y + 1))] + 
                          elevationIn[locIndex(vec2u(loc.x + 1, loc.y - 1))] +
                          elevationIn[locIndex(vec2u(loc.x - 1, loc.y + 1))] + 
                          elevationIn[locIndex(vec2u(loc.x - 1, loc.y - 1))]) / 4;
                elevationOut[i] = res;
              }
              default: {
                elevationOut[i] = elevationIn[i];
              }
            }
          }
        `
      })

      // Shaders

      const elevationShaderModule = this.device.createShaderModule({
        label: "Elevation Shader",
        code: `
          struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(1) elevation: f32
          }

          @group(0) @binding(0) var<uniform> grid: vec2f;
          @group(0) @binding(1) var<storage> elevations: array<f32>;

          @vertex
          fn vertexMain(@location(0) pos: vec2f, @builtin(instance_index) instance: u32)
          -> VertexOutput {
            let i = f32(instance);
            let cell = vec2f(i % grid.x, floor(i / grid.y));

            let cellOffset = cell / grid * 2;
            let gridPos = pos / grid - 1 + cellOffset;

            var output: VertexOutput;
            output.pos = vec4f(gridPos, 0, 1);
            output.elevation = elevations[instance];
            return output;
          }

          @fragment
          fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
            return vec4f(input.elevation, input.elevation, input.elevation, 1.0);
          }
        `
      });

      // Pipelines

      const elevationPipeline = this.device.createRenderPipeline({
        label: "Elevation Pipeline",
        layout: pipelineLayout,
        vertex: {
          module: elevationShaderModule,
          entryPoint: "vertexMain",
          buffers: [vertexBufferLayout]
        },
        fragment: {
          module: elevationShaderModule,
          entryPoint: "fragmentMain",
          targets: [{
            format: this.canvasFormat
          }]
        }
      });

      const computePipeline = this.device.createComputePipeline({
        label: "Compute Pipeline",
        layout: pipelineLayout,
        compute: {
          module: elevationComputeModule,
          entryPoint: "computeMain"
        }
      });

      // Bind Groups

      const bindGroups = [
        this.device.createBindGroup({
          label: "Elevation Render Group A",
          layout: bindGroupLayout,
          entries: [{
            binding: 0,
            resource: { buffer: gridBuffer }
          }, {
            binding: 1,
            resource: { buffer: elevationBuffers[0] }
          }, {
            binding: 2,
            resource: { buffer: elevationBuffers[1] }
          }, {
            binding: 3,
            resource: { buffer: radixBuffer }
          }]
        }),
        this.device.createBindGroup({
          label: "Elevation Render Group B",
          layout: bindGroupLayout,
          entries: [{
            binding: 0,
            resource: { buffer: gridBuffer }
          }, {
            binding: 1,
            resource: { buffer: elevationBuffers[1] }
          }, {
            binding: 2,
            resource: { buffer: elevationBuffers[0] }
          }, {
            binding: 3,
            resource: { buffer: radixBuffer }
          }]
        }),
      ]
      let step = 0;
      const render = (radix) => {
        this.device.queue.writeBuffer(radixBuffer, 0, new Uint32Array([radix]));
        const encoder = this.device.createCommandEncoder();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, bindGroups[step % 2]);

        const workgroupCount = Math.ceil(TOTAL_RESOLUTION / WORKGROUP_SIZE / radix);
        computePass.dispatchWorkgroups(workgroupCount, workgroupCount);

        computePass.end();

        step++;

        const renderPass = encoder.beginRenderPass({
          colorAttachments: [{
                    view: this.context.getCurrentTexture().createView(),
                    loadOp: "clear",
                    clearValue: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
                    storeOp: "store",
                }]
        });

        renderPass.setPipeline(elevationPipeline);
        renderPass.setVertexBuffer(0, vertexBuffer);
        renderPass.setBindGroup(0, bindGroups[step % 2]);
        renderPass.draw(vertices.length / 2, TOTAL_RESOLUTION * TOTAL_RESOLUTION);

        renderPass.end();

        this.device.queue.submit([encoder.finish()]);
      }

      render(4);
      render(2);
      render(1);

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
</style>