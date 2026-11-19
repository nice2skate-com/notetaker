import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" lets the build run from any path (GitHub Pages project site, local file server, …)
export default defineConfig({ base: "./", plugins: [react()] });
