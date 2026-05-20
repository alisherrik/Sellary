/** @type {import('next').NextConfig} */
const offlineModeEnabled = process.env.NEXT_PUBLIC_ENABLE_OFFLINE_MODE === "true";
const apiProxyTarget = (process.env.NEXT_PUBLIC_API_PROXY_TARGET || "http://127.0.0.1:8001").replace(/\/$/, "");

const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  swcMinify: true,
  disable: process.env.NODE_ENV === "development" || !offlineModeEnabled,
  workboxOptions: {
    disableDevLogs: true,
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ZERO TRUST: Service Worker MUST NEVER cache API responses
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Exclude ALL /api/* routes from precaching and runtime caching
    exclude: [
      // API routes - NEVER CACHE (NON-NEGOTIABLE)
      /\.api\//,
      /\/api\/.*/,
    ],
    // Runtime caching strategies - explicitly block API routes
    runtimeCaching: [
      {
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // BLACKLIST: NEVER CACHE API ROUTES (bypass cache)
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        urlPattern: /^https?.*\/api\/.*/,
        handler: 'NetworkOnly', // NEVER cache, always fetch from network
        options: {
          cacheName: 'api-bypass',
          expiration: {
            maxEntries: 0, // Don't store anything
          },
          cacheableResponse: {
            statuses: [], // Don't cache any status codes
          },
        },
      },
    ],
  },
});

const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiProxyTarget}/api/:path*`,
      },
    ];
  },
  reactStrictMode: true,
}

module.exports = withPWA(nextConfig);
