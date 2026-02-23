import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";
import { resolve } from "path";

export default defineConfig({
  root: "src",
  publicDir: resolve(__dirname, "src/assets"),
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: process.env.NODE_ENV === "development",
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: false,
      },
    },
  },
  plugins: [
    webExtension({
      manifest: "manifest.json",
      watchFilePaths: ["src/**/*"],
      additionalInputs: [
        "offscreen/offscreen.html",
      ],
    }),
  ],
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
});
