import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { fileURLToPath } from "url";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5174,
    strictPort: true,
    hmr: { port: 5174 },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        offscreen: "src/offscreen.html",
      },
    },
  },
});
