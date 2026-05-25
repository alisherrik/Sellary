const withPWA = require("@ducanh2912/next-pwa").default;

const isDev = process.env.NODE_ENV === "development";

const apiProxyTarget = process.env.NEXT_PUBLIC_API_PROXY_TARGET || "http://127.0.0.1:8001";

const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version || "1.0.0",
  },
  async rewrites() {
    return [
      { source: '/health', destination: `${apiProxyTarget}/health` },
      { source: '/api/:path*', destination: `${apiProxyTarget}/api/:path*` },
    ];
  },
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['@heroicons/react', 'recharts', 'date-fns'],
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
};

const pwaConfig = {
  dest: "public",
  register: false,
  disable: isDev,
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
    runtimeCaching: [
      {
        urlPattern: /^\/api\/.*/,
        handler: "NetworkOnly",
      },
      {
        urlPattern: /^\/_next\/static\/.*/,
        handler: "CacheFirst",
      },
      {
        urlPattern: /^\/_next\/data\/.*/,
        handler: "NetworkFirst",
        options: {
          cacheName: "next-data",
          networkTimeoutSeconds: 3,
        },
      },
      {
        urlPattern: ({ request }) =>
          request.mode === "navigate",
        handler: "NetworkFirst",
        options: {
          cacheName: "pages",
          networkTimeoutSeconds: 3,
        },
      },
      {
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "images",
          expiration: {
            maxEntries: 50,
          },
        },
      },
    ],
    exclude: [/middleware-manifest\.json$/],
  },
};

module.exports = withPWA(pwaConfig)(nextConfig);
