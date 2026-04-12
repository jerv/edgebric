import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@edgebric/types": path.resolve(__dirname, "../../shared/types/src/index.ts"),
      },
    },
    define: {
      // Embed cloud OAuth credentials at build time so they're in the compiled
      // binary, not in the source code. Set these env vars in CI or .env.local.
      // Users get one-click "Connect Google Drive" without manual config.
      "BUILTIN_GOOGLE_DRIVE_CLIENT_ID": JSON.stringify(process.env["GOOGLE_DRIVE_CLIENT_ID"] ?? ""),
      "BUILTIN_GOOGLE_DRIVE_CLIENT_SECRET": JSON.stringify(process.env["GOOGLE_DRIVE_CLIENT_SECRET"] ?? ""),
    },
    build: {
      rollupOptions: {
        input: "src/main/index.ts",
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@edgebric/types": path.resolve(__dirname, "../../shared/types/src/index.ts"),
      },
    },
    build: {
      rollupOptions: {
        input: "src/preload/index.ts",
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    root: "src/renderer",
    resolve: {
      alias: {
        "@edgebric/types": path.resolve(__dirname, "../../shared/types/src/index.ts"),
      },
    },
    build: {
      rollupOptions: {
        input: "src/renderer/index.html",
      },
    },
  },
});
