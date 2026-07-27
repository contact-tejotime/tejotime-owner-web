import type { NextConfig } from "next";

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
  experimental: {
    // Client Router Cache: reuse an already-visited page's data on back/forward
    // and quick re-navigation instead of refetching. `dynamic` covers our
    // cookie-gated (dynamically rendered) pages. A mutation's router.refresh()
    // still busts this, so edits are never hidden by it.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
