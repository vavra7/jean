# syntax=docker/dockerfile:1
FROM node:24-alpine AS builder
WORKDIR /jean
COPY package.json pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
RUN corepack enable && pnpm install
RUN pnpm --filter shared build
RUN pnpm --filter web build

FROM nginx:alpine
RUN apk add --no-cache curl
COPY --from=builder /jean/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=5s --timeout=2s --retries=10 --start-period=10s \
  CMD curl -fsS http://127.0.0.1:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
