import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  outputFileTracingRoot: __dirname,
  // The floating "N" badge sits above sheets and blocks "Add to queue" on mobile.
  // It is only a Next.js dev tool — hide it so it never looks like part of the UI.
  devIndicators: false,
};

export default nextConfig;
