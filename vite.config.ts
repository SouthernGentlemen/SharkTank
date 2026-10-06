import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { renderGameDocument } from "./src/client/game-document";

const gameDocumentEntry = fileURLToPath(new URL("./index.html", import.meta.url));

const gameDocumentPlugin = (): Plugin => ({
  name: "sharktank-react-game-document",
  transformIndexHtml: {
    order: "pre",
    handler: () => renderGameDocument(),
  },
});

export default defineConfig({
  plugins: [gameDocumentPlugin(), react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: gameDocumentEntry,
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
    // The 3D arena is intentionally lazy-loaded; its ~230 kB gzip payload includes Three.js.
    // Keep warnings focused on accidental growth beyond the known game-runtime boundary.
    chunkSizeWarningLimit: 900,
  },
  // Static portfolio imagery is copied into dist/ and served by the Worker's ASSETS binding.
  publicDir: "public",
});
