import { NextResponse } from "next/server";

import { resolveTenantFromHost } from "@/lib/tenant/resolve";

/**
 * Digital Asset Links endpoint.
 * Google spec: https://developers.google.com/digital-asset-links/v1/getting-started
 *
 * Every host that hosts an installable TWA must serve one of these at
 * `/.well-known/assetlinks.json`. The Android system reads it on APK install
 * (and periodically thereafter) to prove that the app publisher also
 * controls the website — that's what keeps TWAs from showing the browser
 * chrome. Without a valid pairing here, the app opens as a Custom Tab with
 * a URL bar instead of "full-screen app" mode.
 *
 * Multi-tenant model:
 *   - Same signing keystore across every ControlDesk TWA build (one
 *     `TWA_SHA256_FINGERPRINT`), because we distribute internally, not
 *     via Play Store — no per-tenant vendor signing story.
 *   - One Android package per tenant (`site.controldesk.<slug>`) so a
 *     device can host multiple tenant apps side-by-side (an OM can
 *     have both the ITPS and DEMO icons on their home screen).
 *   - This route derives the tenant from the request Host header, so
 *     `https://itps.controldesk.site/.well-known/assetlinks.json`
 *     advertises `site.controldesk.itps`, and `demo.controldesk.site`
 *     advertises `site.controldesk.demo`. Apex host advertises the
 *     apex build (`site.controldesk.app`) — the "picker" APK — if
 *     ever we ship one.
 *
 * Env knobs (all optional at build time; route returns [] when
 * fingerprint is unset so the app still deploys pre-TWA):
 *   TWA_SHA256_FINGERPRINT      — colon-delimited SHA-256 of the
 *                                 signing certificate. Get it via
 *                                 `keytool -list -v -keystore ...` and
 *                                 copy the "SHA256:" line verbatim.
 *   TWA_PACKAGE_NAME_PREFIX     — reverse-domain prefix, defaults
 *                                 to `site.controldesk`. Final package
 *                                 name = `<prefix>.<tenant_slug>`.
 *   TWA_APEX_PACKAGE_NAME       — optional override for apex host
 *                                 (default `<prefix>.app`).
 *   TWA_EXTRA_PACKAGES_JSON     — optional JSON array of extra
 *                                 { package_name, sha256 } to advertise
 *                                 (useful during key rotation windows
 *                                 or if multiple keystores are in play).
 *
 * Rules §2 / §19: this endpoint is unauthenticated (proxy `.well-known/`
 * bypass) and cache-friendly (Play Services queries it directly), so we
 * keep it stateless — no DB, no cookies. Response is small enough
 * (< 1kb typical) that Node.js JSON serialisation dominates over any
 * "clever" cache layer.
 */

export const runtime = "nodejs";
// Cache 5 minutes at the edge (rules §22 doesn't require this to be
// live-fresh — a key rotation is a coordinated change, and stale
// assetlinks just means a TWA might briefly open with browser chrome).
export const revalidate = 300;

type AssetLinkStatement = {
  relation: string[];
  target: {
    namespace: "android_app";
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
};

function normaliseFingerprint(raw: string): string {
  // Google accepts either "AB:CD:..." colon form OR spaces; we normalise
  // to upper-case colon form because that's what `keytool` prints and
  // Play Services is happy with. Reject anything that doesn't look like
  // a SHA-256 hex string.
  const cleaned = raw.replace(/\s+/g, "").toUpperCase();
  const withColons = cleaned.includes(":")
    ? cleaned
    : cleaned.match(/.{1,2}/g)?.join(":") ?? cleaned;
  return withColons;
}

function packageNameFor(hostResolution: ReturnType<typeof resolveTenantFromHost>): string {
  const prefix = (process.env.TWA_PACKAGE_NAME_PREFIX ?? "site.controldesk").replace(
    /\.$/,
    "",
  );
  if (hostResolution.kind === "tenant") {
    return `${prefix}.${hostResolution.slug}`;
  }
  return process.env.TWA_APEX_PACKAGE_NAME ?? `${prefix}.app`;
}

function parseExtraPackages(): AssetLinkStatement[] {
  const raw = process.env.TWA_EXTRA_PACKAGES_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{
      package_name?: unknown;
      sha256?: unknown;
    }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const pkg = typeof entry.package_name === "string" ? entry.package_name : "";
      const sha = typeof entry.sha256 === "string" ? entry.sha256 : "";
      if (!pkg || !sha) return [];
      return [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app" as const,
            package_name: pkg,
            sha256_cert_fingerprints: [normaliseFingerprint(sha)],
          },
        },
      ];
    });
  } catch {
    // Malformed env — fail closed (silent). We don't want an ops typo
    // to 500 the well-known endpoint; return the primary statement only.
    return [];
  }
}

export async function GET(request: Request) {
  const fingerprint = process.env.TWA_SHA256_FINGERPRINT?.trim();

  const host = request.headers.get("host");
  const resolution = resolveTenantFromHost(host);

  const statements: AssetLinkStatement[] = [];

  if (fingerprint) {
    statements.push({
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageNameFor(resolution),
        sha256_cert_fingerprints: [normaliseFingerprint(fingerprint)],
      },
    });
  }

  statements.push(...parseExtraPackages());

  return NextResponse.json(statements, {
    headers: {
      // Google's verifier hits this from Google's fleet, not the user's
      // device — no need for CORS, but must be pure JSON without an
      // HTML fallback wrapper. `application/json` is required by spec.
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
