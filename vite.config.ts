import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  root: "apps/web",
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          canvas: ["@xyflow/react"],
          validation: ["zod", "acorn"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/webhooks": "http://127.0.0.1:3001",
    },
  },
});
