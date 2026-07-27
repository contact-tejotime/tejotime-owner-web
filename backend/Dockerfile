# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY db ./db
# db/migrate.ts imports src/db/ssl.ts (host-derived TLS logic, shared with the
# app's own pool). Only db/ was excluded from `npm run build`, so this stays
# raw TypeScript here — tsx transpiles it on the fly when the pre-deploy
# command runs `npx tsx db/migrate.ts`.
COPY src ./src
EXPOSE 8080
# Run the API + Socket.IO + in-process cron. (Split to a worker via a second
# service running `node dist/worker.js` when moving to BullMQ/Redis.)
CMD ["node", "dist/server.js"]
