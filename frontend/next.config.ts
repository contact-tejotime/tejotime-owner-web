import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project (multiple lockfiles exist above it).
  turbopack: {
    root: __dirname,
  },

  // 👇 makes the browser load the store's CSS/JS/fonts straight from Render,
  //    bypassing Vercel's /_next handling that was 404ing the stylesheet
  assetPrefix: "https://tejotime-owner.onrender.com",

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
