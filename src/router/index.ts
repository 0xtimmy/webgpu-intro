import { createRouter, createWebHistory, RouteRecordRaw } from "vue-router";
import Intro from "../views/Intro.vue";
import PerlinNoise from "../views/PerlinNoise.vue";

const routes: Array<RouteRecordRaw> = [
  {
    path: "/",
    name: "PerlinNoise",
    component: PerlinNoise,
    meta: {
      title: "Perlin Noise" 
    }
  },
  {
    path: "/intro",
    name: "Intro",
    component: Intro,
    meta: {
      title: "Game of Life" 
    }
  },
];

const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes,
});

export default router;
