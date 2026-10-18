# Builds the web client and API server into one image. Voice runs in the separate LiveKit container.
FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.0.0
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server/package.json server/
COPY client/package.json client/
RUN pnpm install --frozen-lockfile --filter @onehub/server --filter @onehub/client
COPY server server
COPY client client
RUN pnpm --filter @onehub/client build && pnpm --filter @onehub/server build \
 && pnpm --filter @onehub/server deploy --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production CLIENT_DIST=/app/public PORT=4000
COPY --from=build /out .
COPY --from=build /app/server/dist dist
COPY --from=build /app/client/dist public
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
