import { defineConfig } from "vite";
import type { Connect } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

// PORT is only used by the dev server; during `vite build` it is irrelevant.
// Default to 8080 so that `pnpm build` works without injecting env vars.
const rawPort = process.env.PORT ?? "8080";
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// BASE_PATH controls the Vite `base` option, which prefixes all asset URLs in
// the static build output.  Default to "/" for standalone / Docker builds.
const basePath = process.env.BASE_PATH ?? "/";
// The same CAFA_DEMO_MODE setting gates the server-side override. It is
// compiled to false for production even if an environment is misconfigured.
const demoRoleHarnessEnabled =
  process.env.NODE_ENV !== "production" && process.env.CAFA_DEMO_MODE === "true";

export default defineConfig({
  base: basePath,
  define: {
    __CAFA_DEMO_MODE_ENABLED__: JSON.stringify(demoRoleHarnessEnabled),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    // Fix: Vite dev server returns text/html for .webmanifest virtual modules.
    // Chrome validates the MIME type before granting installability.
    {
      name: "webmanifest-mime-fix",
      configureServer(server) {
        const fixMime: Connect.NextHandleFunction = (req, res, next) => {
          if (req.url === "/manifest.webmanifest") {
            const orig = res.setHeader.bind(res);
            res.setHeader = (name: string, value: unknown) => {
              if (typeof name === "string" && name.toLowerCase() === "content-type") {
                return orig("Content-Type", "application/manifest+json; charset=utf-8");
              }
              return (orig as (n: string, v: unknown) => void)(name, value);
            };
          }
          next();
        };
        server.middlewares.use(fixMime);
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "CAFA PMIS",
        short_name: "CAFA",
        description: "CAFA Development Organization project management for Sudan operations. Tracks projects, beneficiaries, budgets, reports, and risks across 18 Sudanese states.",
        theme_color: "#1a2744",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "any",
        start_url: basePath,
        scope: basePath,
        lang: "en",
        categories: ["productivity", "business"],
        icons: [
          { src: `${basePath}icons/icon-72.png`,  sizes: "72x72",   type: "image/png", purpose: "any" },
          { src: `${basePath}icons/icon-96.png`,  sizes: "96x96",   type: "image/png", purpose: "any" },
          { src: `${basePath}icons/icon-128.png`, sizes: "128x128", type: "image/png", purpose: "any" },
          { src: `${basePath}icons/icon-144.png`, sizes: "144x144", type: "image/png", purpose: "any" },
          { src: `${basePath}icons/icon-152.png`, sizes: "152x152", type: "image/png", purpose: "any" },
          { src: `${basePath}icons/icon-180.png`, sizes: "180x180", type: "image/png", purpose: "any" },
          { src: `${basePath}icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: `${basePath}icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: `${basePath}icons/icon-384.png`, sizes: "384x384", type: "image/png", purpose: "any" },
          { src: `${basePath}icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: `${basePath}icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: `${basePath}icons/icon.svg`,     sizes: "any",      type: "image/svg+xml", purpose: "any" },
        ],
        screenshots: [
          {
            src: `${basePath}opengraph.jpg`,
            sizes: "1200x630",
            type: "image/jpeg",
            // @ts-expect-error form_factor is valid in newer PWA spec
            form_factor: "wide",
            label: "CAFA PMIS — Desktop Dashboard",
          },
          {
            src: `${basePath}screenshot-mobile.jpg`,
            sizes: "390x844",
            type: "image/jpeg",
            // @ts-expect-error form_factor is valid in newer PWA spec
            form_factor: "narrow",
            label: "CAFA PMIS — Mobile Login",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,ttf,eot}"],
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // Use the dedicated test tsconfig that enables @testing-library/jest-dom
    // types and adjusts moduleResolution away from "bundler" mode, which
    // breaks @testing-library/react type exports.
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Cap worker fan-out on shared CI/review runners. Full rendered-form suites
    // create several jsdom apps per file; uncapped worker counts cause unrelated
    // tests to exceed their timeout under contention.
    maxWorkers: 4,
    minWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
