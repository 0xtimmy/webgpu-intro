<template>
    <nav>
        <li 
            :key="route.title" 
            v-for="route in routes" 
            @click="() => { navigate(route.path)}"
        >
            {{ route.meta.title }}
        </li>
    </nav>
</template>

<script lang="js">
import { defineComponent } from "vue";

export default defineComponent({
    name: "Navbar",
    computed: {
        routes: function() {
            return this.$router.getRoutes();
        }
    },
    methods: {
        navigate: function(path) {
            this.$router.push(path);
        }
    }
})
</script>

<style scoped>
nav {
    margin: .5rem 2rem;
    display: flex;
    gap: 1rem;
}
nav li {
    list-style: none;
}
nav li:hover {
    text-decoration: underline;
    cursor: pointer;
}
</style>