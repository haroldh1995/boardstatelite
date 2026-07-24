import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { APP_GITHUB_PAGES_BASE, APP_NAME } from "./src/appMetadata.js";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? APP_GITHUB_PAGES_BASE : "/",
  build: {
    chunkSizeWarningLimit: 750,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "pwa-192.svg", "pwa-512.svg"],
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description:
          "A focused personal Magic: The Gathering battlefield calculator for life, counters, tokens, and supported triggers.",
        theme_color: "#050907",
        background_color: "#050907",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: ".",
        scope: ".",
        icons: [
          {
            src: "pwa-192.svg",
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
          {
            src: "pwa-512.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        clientsClaim: false,
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        skipWaiting: false,
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webp,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.scryfall\.com\/cards\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "scryfall-card-api",
              expiration: {
                maxEntries: 250,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              networkTimeoutSeconds: 8,
            },
          },
          {
            urlPattern: /^https:\/\/cards\.scryfall\.io\//,
            handler: "CacheFirst",
            options: {
              cacheName: "scryfall-card-images",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 90,
              },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    exclude: ["node_modules/**", "dist/**", "tests/e2e/**"],
  },
});
