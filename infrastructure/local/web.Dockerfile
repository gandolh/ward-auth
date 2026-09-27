# Ward's local gateway image: the built UI behind Caddy. Local only; on the VPS
# the host's own Caddy serves ui/dist from /var/www/ward.
#
# Build context is the repo root, as for infrastructure/Dockerfile.

FROM node:24-alpine AS ui
WORKDIR /app
# Same manifest set as infrastructure/Dockerfile: npm ci checks the lockfile
# against the workspaces, even though only the ui one is installed here.
COPY package.json package-lock.json tsconfig.base.json ./
COPY api/package.json ./api/
COPY ui/package.json ./ui/
COPY client/package.json ./client/
RUN npm ci -w @ward/ui --include-workspace-root
COPY ui ./ui
RUN npm run build -w @ward/ui

FROM caddy:2-alpine
COPY infrastructure/local/Caddyfile /etc/caddy/Caddyfile
COPY --from=ui /app/ui/dist /srv/ward
