/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      "/api/ask": ["./lib/data/**/*"],
      "/api/users": ["./lib/data/**/*"],
    },
  },
};

module.exports = nextConfig;
