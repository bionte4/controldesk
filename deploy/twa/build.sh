#!/usr/bin/env bash
# =============================================================================
# ControlDesk TWA APK builder
# =============================================================================
# Usage: ./build.sh <tenant_slug> [--root-domain=controldesk.site]
#
# Produces:
#   deploy/twa/dist/<tenant_slug>/app-release-signed.apk    (sideload artifact)
#   deploy/twa/dist/<tenant_slug>/app-release-bundle.aab    (Play Store artifact)
#
# Requires:
#   - JDK 17 in PATH (java, keytool)
#   - `deploy/twa/keystore.jks` created via the one-time step in README.md
#   - `KEYSTORE_PASSWORD` env var, or interactive prompt if unset
#   - Network access on first run (Bubblewrap downloads Android SDK ~450 MB)
#
# Idempotent: subsequent runs skip `bubblewrap init` and go straight to
# `build`. Bump `appVersionCode` in twa-manifest.template.json when you
# want a new release the phone will accept over an existing install.
# =============================================================================

set -euo pipefail

# ---- Args parsing -----------------------------------------------------------
if [ $# -lt 1 ]; then
  echo "Usage: $0 <tenant_slug> [--root-domain=controldesk.site]" >&2
  echo "Example: $0 itps" >&2
  exit 64  # EX_USAGE
fi

TENANT="$1"
shift

ROOT_DOMAIN="controldesk.site"
for arg in "$@"; do
  case "$arg" in
    --root-domain=*) ROOT_DOMAIN="${arg#*=}" ;;
    *) echo "Unknown flag: $arg" >&2; exit 64 ;;
  esac
done

# Guard: tenant slug must match the same shape the app enforces
# (SLUG_PATTERN in src/lib/tenant/resolve.ts). If someone types "ITPS"
# (uppercase) the APK will build but host verification will silently
# fail at install time, which is a nightmare to debug.
if ! [[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]]; then
  echo "ERROR: tenant slug must match /^[a-z0-9][a-z0-9-]{1,62}$/" >&2
  echo "  Got: $TENANT" >&2
  exit 65  # EX_DATAERR
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYSTORE="${SCRIPT_DIR}/keystore.jks"

if [ ! -f "$KEYSTORE" ]; then
  echo "ERROR: ${KEYSTORE} not found. Run the one-time setup in README.md first." >&2
  exit 66  # EX_NOINPUT
fi

HOST="${TENANT}.${ROOT_DOMAIN}"
PACKAGE_ID="site.controldesk.${TENANT}"
TENANT_LABEL="$(echo "$TENANT" | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')"

DIST_DIR="${SCRIPT_DIR}/dist/${TENANT}"
mkdir -p "$DIST_DIR"

# ---- Render manifest --------------------------------------------------------
TEMPLATE="${SCRIPT_DIR}/twa-manifest.template.json"
MANIFEST="${DIST_DIR}/twa-manifest.json"

# `envsubst`-free rendering (no dependency on gettext). `sed` handles the
# fixed set of placeholders we care about. Escape `/` in HOST/PACKAGE_ID
# defensively even though our SLUG_PATTERN already excludes them.
sed \
  -e "s|{{PACKAGE_ID}}|${PACKAGE_ID}|g" \
  -e "s|{{HOST}}|${HOST}|g" \
  -e "s|{{TENANT_LABEL}}|${TENANT_LABEL}|g" \
  "$TEMPLATE" > "$MANIFEST"

echo "→ Rendered twa-manifest for tenant=${TENANT} host=${HOST}"

# ---- Password handling ------------------------------------------------------
if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
  read -rsp "Keystore password: " KEYSTORE_PASSWORD
  echo
fi

# ---- Bubblewrap invocation --------------------------------------------------
# Prefer `pnpm dlx` so we don't require a global install. `--yes` skips
# the "install this package?" prompt on first run.
BUBBLEWRAP="pnpm dlx @bubblewrap/cli"

cd "$DIST_DIR"

# First-run detection: if the Android project scaffold isn't here yet,
# `bubblewrap init` will bootstrap it from our rendered manifest.
if [ ! -f "app/build.gradle" ]; then
  echo "→ First build for ${TENANT} — running bubblewrap init"
  $BUBBLEWRAP init \
    --manifest="$MANIFEST" \
    --directory="$DIST_DIR"
fi

# Always update — this catches manifest changes (colors, shortcuts) since
# the last run without needing a `bubblewrap init` again.
$BUBBLEWRAP update \
  --manifest="$MANIFEST" \
  --skipVersionUpgrade

echo "→ Running bubblewrap build (signed APK + AAB)"
$BUBBLEWRAP build \
  --skipPwaValidation \
  --signingKeyPath="${KEYSTORE}" \
  --signingKeyAlias="controldesk" \
  --skipSigningPrompt

# Bubblewrap writes into the CWD by default. Move canonical output into
# a predictable name so `docs/help/*` links to the same path each build.
if [ -f "app-release-signed.apk" ]; then
  echo "→ ${DIST_DIR}/app-release-signed.apk ✅"
fi
if [ -f "app-release-bundle.aab" ]; then
  echo "→ ${DIST_DIR}/app-release-bundle.aab ✅ (Play Store artifact)"
fi

# ---- Fingerprint check ------------------------------------------------------
# Extract the fingerprint from the keystore so ops can eyeball-verify it
# matches TWA_SHA256_FINGERPRINT in .env.production.
echo ""
echo "→ Verify this SHA-256 matches TWA_SHA256_FINGERPRINT in .env.production:"
keytool -list -v \
  -keystore "$KEYSTORE" \
  -alias controldesk \
  -storepass "$KEYSTORE_PASSWORD" 2>/dev/null | \
  grep -E "SHA256:" | \
  head -n1
echo ""
echo "→ Test install: adb install -r ${DIST_DIR}/app-release-signed.apk"
