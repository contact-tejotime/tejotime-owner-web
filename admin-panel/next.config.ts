import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project (multiple lockfiles exist above it).
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Client Router Cache: reuse an already-visited page's data on back/forward
    // and quick re-navigation instead of refetching. `dynamic` covers our
    // cookie-gated (dynamically rendered) pages. A mutation's router.refresh()
    // still busts this, so edits are never hidden by it.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
