import { defineConfig } from "@rsbuild/core";

export default defineConfig({
  source: {
    entry: {
      loader: "./src/frontend/loader.ts",
    },
  },
  tools: {
    htmlPlugin: false,
  },
  output: {
    target: "web",
    assetPrefix: "auto",
    cleanDistPath: true,
    distPath: {
      root: "build/frontend-dist",
      js: ".",
      jsAsync: "chunks",
      css: "chunks",
      cssAsync: "chunks",
    },
    filename: {
      js: ({ chunk }) => chunk?.name === "loader"
        ? "loader.js"
        : "[name].[contenthash:8].js",
      css: "[name].[contenthash:8].css",
    },
    sourceMap: false,
  },
});
