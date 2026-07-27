import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 4. Externalize Tauri plugins for cross-platform Docker builds
  //    (npm install on Linux doesn't pull macOS/Windows-native plugin binaries)
  build: {
    rollupOptions: {
      external: [
        "@tauri-apps/plugin-notification",
        "@tauri-apps/plugin-screenshots",
        "@tauri-apps/plugin-global-shortcut",
        "@tauri-apps/plugin-autostart",
        "@tauri-apps/plugin-clipboard",
        "@tauri-apps/plugin-updater",
        "@tauri-apps/plugin-dialog",
        "@tauri-apps/api/core",
        "@tauri-apps/api/event",
      ],
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
