import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

const nextConfig: NextConfig = {
  // Standalone bundle required by our production Dockerfile (rules §1/§2).
  // Emits `.next/standalone/server.js` with a minimal, self-contained runtime.
  output: "standalone",
  // The `x-forwarded-host` header from a reverse-proxy in front of the
  // container must be trusted so tenant subdomain resolution keeps working
  // behind Nginx / Caddy / Traefik in production.
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000", "*.localhost:3000"],
    },
  },
};

export default withNextIntl(nextConfig);
