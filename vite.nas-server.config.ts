import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    ssr: "nas/server.ts",
    outDir: "dist/nas",
    emptyOutDir: false,
    target: "node22",
    sourcemap: false,
    minify: true,
    rollupOptions: {
      output: {
        entryFileNames: "server.mjs",
      },
    },
  },
});
