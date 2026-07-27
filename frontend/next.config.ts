import type { NextConfig } from "next";

// 👇 makes the browser load the store's CSS/JS/fonts straight from this service's
//    own origin, bypassing Vercel's /_next handling that was 404ing the stylesheet.
//    Leave NEXT_PUBLIC_ASSET_PREFIX empty locally so assets load from localhost.
const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX?.trim();

const nextConfig: NextConfig = {
  // Pin the workspace root to this project (multiple lockfiles exist above it).
  turbopack: {
    root: __dirname,
  },
  // Same monorepo-root problem, for the standalone build's file tracer instead
  // of the dev bundler — without this it can trace outside this project.
  outputFileTracingRoot: __dirname,
  // Minimal self-contained server for the Docker runtime image (see Dockerfile).
  output: "standalone",

  ...(assetPrefix ? { assetPrefix } : {}),

  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
