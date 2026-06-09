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

module.exports = nextConfig;
