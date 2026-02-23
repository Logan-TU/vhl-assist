import { defineConfig, type Plugin } from "vite";
import webExtension from "vite-plugin-web-extension";
import { resolve } from "path";
import { copyFileSync, existsSync, mkdirSync } from "fs";

/**
 * Vite plugin to rewrite the Transformers.js / ONNX Runtime CDN URL
 * at build time.  The library sets:
 *   ONNX_ENV.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/@huggingface/...`
 * We replace the CDN base with a marker that our runtime code overrides.
 * This guarantees the CDN is never hit, even if our runtime override fails.
 */
function rewriteOnnxCdnUrl(): Plugin {
  return {
    name: "rewrite-onnx-cdn-url",
    enforce: "post",
    renderChunk(code) {
      // Replace the CDN template literal that Transformers.js uses:
      //   `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${version}/dist/`
      // The minified form keeps the template literal.  We replace the static
      // prefix so it resolves to a relative path ("./" prefix) at runtime.
      if (code.includes("cdn.jsdelivr.net/npm/@huggingface/transformers")) {
        return code.replace(
          /https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@[^`"']*/g,
          "./"
        );
      }
      return null; // no change
    },
  };
}

/**
 * Vite plugin to copy ONNX Runtime WASM/worker files to the dist output.
 * These files are loaded at runtime by onnxruntime-web and must be served
 * from the extension's own origin (CSP blocks CDN fetches).
 */
function copyOnnxRuntimeFiles() {
  return {
    name: "copy-onnx-runtime",
    closeBundle() {
      const distDir = resolve(__dirname, "dist");
      if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

      const onnxDist = resolve(
        __dirname,
        "node_modules/onnxruntime-web/dist"
      );
      const filesToCopy = [
        "ort-wasm-simd-threaded.jsep.mjs",
        "ort-wasm-simd-threaded.jsep.wasm",
      ];

      for (const file of filesToCopy) {
        const src = resolve(onnxDist, file);
        const dest = resolve(distDir, file);
        if (existsSync(src)) {
          copyFileSync(src, dest);
          console.log(`  Copied ${file} to dist/`);
        }
      }
    },
  };
}

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
    copyOnnxRuntimeFiles(),
    rewriteOnnxCdnUrl(),
  ],
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
});
