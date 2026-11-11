import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    lib: {
      entry: {
        aliases: "src/aliases.ts",
        index: "src/index.ts",
        vite: "src/vite.ts",
        runtime: "src/runtime.ts",
        capture: "src/capture.ts",
        "capture-factory": "src/capture-factory.ts",
        "ai-factory": "src/ai-factory.ts",
        "plugin-data-factory": "src/plugin-data-factory.ts",
        "agent-factory": "src/agent-factory.ts",
        "observation-factory": "src/observation-factory.ts",
        "reminder-factory": "src/reminder-factory.ts",
        "popup-manager": "src/popup-manager.ts",
        "native-event-bridge": "src/native-event-bridge.ts",
        dialog: "src/dialog.ts",
        "tauri-core-shim": "src/tauri-core-shim.ts",
        "tauri-event-shim": "src/tauri-event-shim.ts",
        "tauri-window-shim": "src/tauri-window-shim.ts",
        "tauri-webview-shim": "src/tauri-webview-shim.ts",
        "tauri-webview-window-shim": "src/tauri-webview-window-shim.ts",
        "tauri-app-shim": "src/tauri-app-shim.ts",
        "tauri-plugin-dialog-shim": "src/tauri-plugin-dialog-shim.ts",
        "tauri-plugin-opener-shim": "src/tauri-plugin-opener-shim.ts",
        "tauri-plugin-process-shim": "src/tauri-plugin-process-shim.ts",
        "tauri-plugin-updater-shim": "src/tauri-plugin-updater-shim.ts",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        "@tauri-apps/api/core",
        "@tauri-apps/api/event",
        "@tauri-apps/api/dpi",
        "@tauri-apps/plugin-dialog",
      ],
      output: {
        entryFileNames: "[name].js",
      },
    },
    sourcemap: true,
    emptyOutDir: true,
    outDir: "dist",
  },
  plugins: [
    dts({
      entryRoot: "src",
      include: ["src/**/*"],
    }),
  ],
});
