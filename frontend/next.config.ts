import type { NextConfig } from "next";

// 👇 makes the browser load the store's CSS/JS/fonts straight from this service's
//    own origin, bypassing Vercel's /_next handling that was 404ing the stylesheet.
//    Leave NEXT_PUBLIC_ASSET_PREFIX empty locally so assets load from localhost.
const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX?.trim();

// Industry pages are served at the root (www.tejotime.com/barbershops) but live in
// app/industries/[slug]/, because a second root dynamic segment would collide with
// app/[phone]/. Must match INDUSTRY_SLUGS in src/components/landing/landingData.ts —
// it can't be imported here (landingData pulls in @/i18n).
const INDUSTRY_SLUG_PATTERN =
  "hair-salons|barbershops|nail-studios|spas|med-spas|massage-therapy|physical-therapy|tattoo-studios|pet-grooming";

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

  // Old /industries/<slug> links (shared, indexed) move permanently to /<slug>. Redirects run
  // only on the incoming URL, never on a rewritten one, so this can't loop with the rewrite.
  async redirects() {
    return [
      {
        source: `/industries/:slug(${INDUSTRY_SLUG_PATTERN})`,
        destination: "/:slug",
        permanent: true,
      },
    ];
  },

  // A plain-array rewrite is "afterFiles": applied before dynamic routes, so [phone] never
  // sees these slugs (it would 404 them — it only accepts digits).
  async rewrites() {
    return [
      {
        source: `/:slug(${INDUSTRY_SLUG_PATTERN})`,
        destination: "/industries/:slug",
      },
    ];
  },
};

export default nextConfig;
