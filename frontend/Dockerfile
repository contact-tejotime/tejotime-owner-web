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
# NEXT_PUBLIC_* are inlined into the client bundle at build time. Railway does
# NOT pass service variables into `docker build` automatically — each one this
# app uses must be declared here and set as a Build Variable in the dashboard.
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SOCKET_URL
ARG NEXT_PUBLIC_ASSET_PREFIX
# Origin allowed to drive the admin's live theme preview (?preview=1). Defaults to
# https://admin.tejotime.com in code; set this when the admin runs anywhere else — e.g. the
# interim *.up.railway.app domain, or a staging deploy — or every postMessage is dropped.
ARG NEXT_PUBLIC_ADMIN_ORIGIN
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL \
    NEXT_PUBLIC_ASSET_PREFIX=$NEXT_PUBLIC_ASSET_PREFIX \
    NEXT_PUBLIC_ADMIN_ORIGIN=$NEXT_PUBLIC_ADMIN_ORIGIN
RUN npm run build

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
# The standalone server.js reads PORT itself — no -p flag needed, unlike the
# `next start` CLI.
CMD ["node", "server.js"]
