# Next.js frontend for Railway. Deployed with `railway up` FROM sellary-frontend/
# (build context = this directory), mirroring the backend's sellary-backend/
# railway.json pattern. Deploy settings live in sellary-frontend/railway.json —
# the repo-root railway.toml (backend alembic preDeploy) must NOT apply here.
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined at build time; the /api rewrite target is
# also read at runtime by next.config.js — keep both in sync.
ARG NEXT_PUBLIC_API_PROXY_TARGET=https://sellary-production-30ec.up.railway.app
ENV NEXT_PUBLIC_API_PROXY_TARGET=$NEXT_PUBLIC_API_PROXY_TARGET
ENV NEXT_PUBLIC_API_URL=/api
RUN npm run build

FROM node:20-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.js ./next.config.js
COPY --from=build /app/node_modules ./node_modules
ENV NEXT_PUBLIC_API_PROXY_TARGET=https://sellary-production-30ec.up.railway.app
EXPOSE 3000
CMD ["sh", "-c", "npx next start -p ${PORT:-3000}"]
