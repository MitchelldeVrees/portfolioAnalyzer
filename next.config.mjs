/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },

  // 👇 Add this block
  webpack: (config) => {
    // yahoo-finance2 pulls in test helpers that import Deno/fs-based mocks.
    // Those modules don't exist in the Vercel/Next bundler, so we stub them out.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@gadicc/fetch-mock-cache/runtimes/deno.ts': false,
      '@gadicc/fetch-mock-cache/stores/fs.ts': false,
      '@std/testing/bdd': false,
      '@std/testing/mock': false,
    };

    return config;
  },
};

export default nextConfig;
