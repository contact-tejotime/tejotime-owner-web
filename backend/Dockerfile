# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY db ./db
EXPOSE 8080
# Run the API + Socket.IO + in-process cron. (Split to a worker via a second
# service running `node dist/worker.js` when moving to BullMQ/Redis.)
CMD ["node", "dist/server.js"]
