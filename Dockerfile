FROM node:22.22.3-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci
COPY server/ server/
COPY web/ web/
RUN npm run build && npm prune --omit=dev

FROM node:22.22.3-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DB_PATH=/data/grokbot.db \
    ENV_PATH=/data/studio.env \
    WEB_DIST_DIR=/app/web/dist
RUN mkdir /data && chown node:node /data
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exitCode=1}).catch(()=>process.exitCode=1)"]
CMD ["node", "server/dist/index.js"]
