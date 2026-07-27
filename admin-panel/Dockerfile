# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_FRONTEND_URL is inlined into the client bundle at build time —
# must be declared here and set as a Build Variable in the Railway dashboard.
# BACKEND_API_BASE_URL is deliberately NOT an ARG: it's read server-side at
# runtime (not NEXT_PUBLIC_*), so it's just a normal Railway service variable,
# no build-time plumbing needed.
ARG NEXT_PUBLIC_FRONTEND_URL
ENV NEXT_PUBLIC_FRONTEND_URL=$NEXT_PUBLIC_FRONTEND_URL
RUN npm run build

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3001
# The standalone server.js reads PORT itself — no -p flag needed, unlike the
# `next start` CLI (which is why the local-dev "start" script's hardcoded
# -p 3001 never mattered here).
CMD ["node", "server.js"]
