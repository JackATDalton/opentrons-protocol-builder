import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base` must match the GitHub Pages sub-path (/<repo>/) or assets 404 on deploy.
// Overridden via BASE_PATH in the Pages workflow; "/" for local dev.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? "/",
  build: { outDir: "dist", sourcemap: true },
});
