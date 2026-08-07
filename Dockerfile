ARG NODE_IMAGE=public.ecr.aws/docker/library/node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573

FROM ${NODE_IMAGE} AS frontend-build
WORKDIR /app
ENV CI=true
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=/api
ARG VITE_APP_RELEASE=container
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_APP_RELEASE=${VITE_APP_RELEASE}
RUN npm run build:release

FROM ${NODE_IMAGE} AS frontend-runtime-base
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

FROM frontend-runtime-base AS frontend
WORKDIR /app
ENV NODE_ENV=production
ENV STATIC_HOST=0.0.0.0
ENV STATIC_PORT=4173
COPY --chown=node:node --from=frontend-build /app/dist ./dist
COPY --chown=node:node scripts/serve-production-assets.mjs ./scripts/serve-production-assets.mjs
COPY --chown=node:node scripts/lib/production-static-server.mjs ./scripts/lib/production-static-server.mjs
COPY --chown=node:node config/production-static-delivery-contract.json ./config/production-static-delivery-contract.json
USER node
EXPOSE 4173
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4173/healthz').then(r=>{if(!r.ok)throw new Error(String(r.status))}).catch(()=>process.exit(1))"]
CMD ["node", "scripts/serve-production-assets.mjs"]

FROM ${NODE_IMAGE} AS server-base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

FROM server-base AS server-build
WORKDIR /app/server
ENV CI=true
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/prisma ./prisma
COPY server/prisma.config.ts ./prisma.config.ts
RUN npm run db:generate
COPY server/src ./src

FROM server-base AS server-runtime-deps
WORKDIR /app/server
ENV CI=true
COPY server/package.json server/package-lock.json ./
RUN npm pkg delete devDependencies \
  && npm ci --omit=dev --omit=peer
COPY --from=server-build /app/server/node_modules/.prisma ./node_modules/.prisma
RUN test ! -d node_modules/prisma && test ! -d node_modules/@prisma/dev

FROM server-base AS server-runtime-base
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

FROM server-runtime-base AS api
WORKDIR /app/server
ENV NODE_ENV=production
ENV PORT=8787
COPY --chown=node:node --from=server-runtime-deps /app/server/node_modules ./node_modules
COPY --chown=node:node --from=server-build /app/server/package.json ./package.json
COPY --chown=node:node --from=server-build /app/server/prisma ./prisma
COPY --chown=node:node --from=server-build /app/server/src ./src
COPY --chown=node:node config /app/config
USER node
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)throw new Error(String(r.status))}).catch(()=>process.exit(1))"]
CMD ["node", "src/index.js"]

FROM api AS worker
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "try{process.kill(1,0)}catch{process.exit(1)}"]
CMD ["node", "src/worker.js"]

FROM server-runtime-base AS migrate
WORKDIR /app/server
ENV NODE_ENV=production
COPY --chown=node:node --from=server-build /app/server/node_modules ./node_modules
COPY --chown=node:node --from=server-build /app/server/package.json ./package.json
COPY --chown=node:node --from=server-build /app/server/prisma ./prisma
COPY --chown=node:node --from=server-build /app/server/prisma.config.ts ./prisma.config.ts
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "./prisma/schema.prisma"]
