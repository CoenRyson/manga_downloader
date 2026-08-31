import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "nas",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../dist/nas/public",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
});
