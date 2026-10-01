import type { NextConfig } from "next";
// Relative and dependency-free on purpose: the config transpiler cannot resolve `@/`, and
// this one list also drives the homepage cards, footer links and the noindex rule.
import { INDUSTRY_STORES } from "./src/lib/industryStores";

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

  // The industry marketing pages are gone; each card now opens a live store. Their old URLs —
  // both /<slug> and the even older /industries/<slug> (shared, indexed) — go permanently and
  // DIRECTLY to the store's short URL, so no one takes a two-hop redirect chain. Redirects run
  // only on the incoming URL, never on a rewritten one, so this can't loop with the rewrite.
  async redirects() {
    return INDUSTRY_STORES.flatMap(({ slug, path }) => [
      { source: `/${slug}`, destination: `/${path}`, permanent: true },
      { source: `/industries/${slug}`, destination: `/${path}`, permanent: true },
    ]);
  },

  // /salon → that store's phone microsite, with /salon kept in the address bar. Order of
  // evaluation: redirects → real folders (demo-store, privacy, …) → these afterFiles rewrites
  // → the [phone] dynamic route, which would otherwise 404 "salon" (it only accepts digits).
  // The trap: a future app/ folder named like one of these words silently takes it over.
  async rewrites() {
    return INDUSTRY_STORES.map(({ path, phone }) => ({
      source: `/${path}`,
      destination: `/${phone}`,
    }));
  },
};

export default nextConfig;
