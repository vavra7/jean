# syntax=docker/dockerfile:1
FROM node:24-alpine
WORKDIR /jean
COPY package.json pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
RUN apk add --no-cache python3 make g++
RUN corepack enable && pnpm install
RUN pnpm --filter shared build
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=2s --retries=10 --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => { if (!r.ok) process.exit(1) })" || exit 1
CMD ["apps/api/node_modules/.bin/tsx", "apps/api/src/index.ts"]
