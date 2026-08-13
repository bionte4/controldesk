# ControlDesk — Caddy build dengan modul Cloudflare DNS untuk wildcard TLS.
#
# Stock `caddy:2.8-alpine` tidak include DNS provider plugin, jadi kita build
# ulang lewat `xcaddy` supaya `dns cloudflare {token}` di Caddyfile bekerja.
#
# Build lokal:
#   docker build -t controldesk/caddy:cloudflare -f deploy/caddy/Dockerfile .
#
# Atau lewat docker-compose.prod.yml (uncomment `build:` di service caddy).

FROM caddy:2.8-builder-alpine AS builder

RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare

FROM caddy:2.8-alpine

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
