import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root — several lockfiles exist above this dir.
  turbopack: { root: __dirname },
};

export default nextConfig;
