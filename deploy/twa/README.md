# TWA (Trusted Web Activity) Build — Android APK for ControlDesk PWA

This folder packages the ControlDesk PWA as a native Android APK using
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap). The APK is
a thin native wrapper (~4 MB) that opens the PWA in a full-screen
Chrome Custom Tab with no browser chrome — it looks and feels like a
regular Android app.

**Distribution model**: internal sideload (no Play Store yet). Signed
with a single internal keystore across all tenants. Users install by
downloading the `.apk` from the Help section on the web app.

---

## Prerequisites (host machine)

Install once:

1. **JDK 17** — Bubblewrap needs Java to invoke `keytool` and `jarsigner`.
   ```bash
   # macOS (Homebrew)
   brew install --cask temurin@17
   # Ubuntu
   sudo apt install openjdk-17-jdk
   # Verify: `java -version` should say 17.x
   ```

2. **Bubblewrap CLI** — installed on-demand via `pnpm dlx` (no global
   pollution). The `build.sh` script wraps it. If you prefer a global
   install: `npm i -g @bubblewrap/cli`.

3. **Android SDK** — Bubblewrap will download the command-line tools
   on first run (~450 MB). If you already have Android Studio
   installed, set `ANDROID_HOME` and Bubblewrap will reuse it:
   ```bash
   export ANDROID_HOME="$HOME/Library/Android/sdk"    # macOS
   export ANDROID_HOME="$HOME/Android/Sdk"            # Linux
   ```

---

## One-time keystore setup

You only do this ONCE. All tenant APKs share the same keystore because
we sideload internally — no per-tenant vendor signing story.

```bash
cd deploy/twa
keytool -genkey -v \
  -keystore keystore.jks \
  -alias controldesk \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -storepass 'CHANGE_ME_strong_password' \
  -keypass 'CHANGE_ME_strong_password' \
  -dname 'CN=ControlDesk, O=ControlDesk, C=ID'
```

**Back up `keystore.jks` immediately** to an offline secret store (1Password,
`pass`, or an encrypted USB). Losing it means every existing install is
locked to the old key and cannot receive updates from a new signature.

Extract the SHA-256 fingerprint you'll paste into `.env.production`:

```bash
keytool -list -v -keystore keystore.jks -alias controldesk | grep SHA256
# Output looks like:
# SHA256: AB:CD:12:34:...   (64 hex chars, colon-separated)
```

Paste that value verbatim into `.env.production`:

```env
TWA_SHA256_FINGERPRINT=AB:CD:12:34:...
```

Redeploy the web app so `/.well-known/assetlinks.json` starts advertising
the fingerprint. Verify with:

```bash
curl https://itps.controldesk.site/.well-known/assetlinks.json
# Should include your package_name + sha256_cert_fingerprints
```

---

## Build a tenant APK

```bash
cd deploy/twa
./build.sh itps      # produces dist/itps/app-release-signed.apk
./build.sh demo      # produces dist/demo/app-release-signed.apk
```

The script:

1. Renders `twa-manifest.template.json` into `dist/<tenant>/twa-manifest.json`
   with the tenant slug substituted into `packageId` and `host`.
2. Invokes `bubblewrap init` (first run only per tenant — subsequent
   runs skip this and go straight to `build`).
3. Signs the APK with `keystore.jks` using the alias `controldesk`.
4. Copies the finished `.apk` and `.aab` to `dist/<tenant>/`.

Output layout:

```
deploy/twa/
├── keystore.jks              (git-ignored)
├── build.sh
├── twa-manifest.template.json
└── dist/
    ├── itps/
    │   ├── app-release-signed.apk       ← sideload this
    │   ├── app-release-bundle.aab       (Play Store, if we ever ship it)
    │   └── twa-manifest.json
    └── demo/
        └── ...
```

---

## Sideload testing

1. Enable "Install unknown apps" for your file manager on Android
   Settings → Apps → Special access → Install unknown apps → Files.
2. Transfer `app-release-signed.apk` to the phone (USB, AirDrop-like,
   or serve it from the app itself via a Help card link).
3. Tap the APK to install.
4. First launch should show a splash screen (background color from
   `manifest.webmanifest`) and then jump straight to the app with NO
   URL bar. If you see a URL bar, `assetlinks.json` isn't matching —
   run `adb logcat | grep -i digital_asset_links` to debug.

---

## Common failure modes

- **APK shows URL bar** → `TWA_SHA256_FINGERPRINT` doesn't match the
  key the APK was signed with. Re-extract with `keytool -list -v` and
  redeploy the web app.
- **"App not installed"** → Existing install on device signed with a
  different key. Uninstall first (users lose data since PWA storage
  is scoped to the app).
- **Splash screen never leaves** → PWA `start_url` returns non-200.
  Check `curl -I https://<host>/` returns 200; if it 3xx-redirects to
  `/login`, TWA is fine (Chrome follows the redirect), but if it
  returns 401/404 the splash hangs.
- **`bubblewrap init` fails with `EACCES: mkdir`** → `ANDROID_HOME` is
  set to a system-owned path. Point it at a user-writable directory.

---

## Rotating keys (rare)

Do NOT rotate keystores lightly. Every existing install becomes
uninstall-only. The recommended path is to add the new key to
`TWA_EXTRA_PACKAGES_JSON` alongside the old one, ship a build signed
with the new key AND opt-in old users to reinstall over a
few-week window, then drop the old fingerprint from env vars.

```env
TWA_SHA256_FINGERPRINT=NEW:FINGERPRINT:...
TWA_EXTRA_PACKAGES_JSON=[{"package_name":"site.controldesk.itps","sha256":"OLD:FINGERPRINT:..."}]
```

---

## References

- Bubblewrap: <https://github.com/GoogleChromeLabs/bubblewrap>
- TWA overview: <https://developer.chrome.com/docs/android/trusted-web-activity>
- Digital Asset Links spec:
  <https://developers.google.com/digital-asset-links/v1/getting-started>
