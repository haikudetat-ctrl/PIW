import type { NextConfig } from "next";
import path from "node:path";

const monorepoRoot = path.resolve(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
