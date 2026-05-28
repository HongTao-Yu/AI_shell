import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rendererRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: rendererRoot,
  plugins: [react()],
  build: {
    outDir: path.resolve(rendererRoot, "../../dist/renderer"),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
