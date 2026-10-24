import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const productionCsp =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: petdesk-asset:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'";
const devCsp =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: petdesk-asset:; font-src 'self'; connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173; base-uri 'none'; form-action 'none'; frame-src 'none'";

export default defineConfig(({ command }) => ({
  root: "src/renderer",
  base: "./",
  plugins: [
    react(),
    command === "serve" && {
      name: "deskpet-dev-csp",
      transformIndexHtml(html: string) {
        return html.replace(productionCsp, devCsp);
      },
    },
  ].filter(Boolean),
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "src/renderer/index.html"),
      },
    },
  },
}));
