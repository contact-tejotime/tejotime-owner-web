import type { NextConfig } from "next";

// 👇 makes the browser load the store's CSS/JS/fonts straight from Render,
//    bypassing Vercel's /_next handling that was 404ing the stylesheet.
//    Leave NEXT_PUBLIC_ASSET_PREFIX empty locally so assets load from localhost.
const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX?.trim();

const nextConfig: NextConfig = {
  // Pin the workspace root to this project (multiple lockfiles exist above it).
  turbopack: {
    root: __dirname,
  },

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
