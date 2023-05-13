<template>
  <div id="lab">
    <Navbar />
    <h1>{{ title }}</h1>
    <router-view class="main" />
    <div class="" :class="{ dev: dev }">
      <div class="in-dev">IN DEVELOPMENT</div>
    </div>
  </div>
</template>

<script>
import { defineComponent } from "vue";
import Navbar from "@/components/Navbar.vue";

export default defineComponent({
  components: {
    Navbar,
  },
  computed: {
    title: function() {
      return this.$route.meta.title;
    },
    dev: function() {
      return true;
    }
  }
})
</script>

<style scoped>

#lab {
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-flow: column nowrap;
}

#lab > h1 {
  margin: 0 2rem;
}
.main {
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: 0px;
}

.dev {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--avalon-color);
  flex-shrink: 0;
  height: 85px;
  background-image: url("./assets/caution.svg");
  background-position: center;
}

.in-dev {
  font-size: 2rem;
  padding: 0 2rem;
  font-weight: bold;
  letter-spacing: 0.35rem;
  display: none;
}

.dev .in-dev {
  background-color: var(--avalon-color);
  border: solid var(--type-color) 4px;
  display: inline-block;
}

</style>
