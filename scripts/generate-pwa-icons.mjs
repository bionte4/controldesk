#!/usr/bin/env node
/**
 * ControlDesk — Generate PWA icon set + favicon dari source logo.
 *
 * Kenapa perlu?
 *   PWA manifest butuh minimal 192x192 dan 512x512, plus "maskable"
 *   varian yang punya safe zone di tengah untuk Android adaptive icons
 *   (system boleh crop bagian pinggir). Chrome DevTools > Application >
 *   Manifest audit kompain kalau tidak lengkap. Ditambah lagi:
 *   - `apple-touch-icon` 180x180 untuk iOS Safari "Add to Home Screen".
 *   - `favicon.ico` multi-size (16, 32, 48) untuk browser tab.
 *
 * Idempotent: jalanin ulang aman, output di `public/icons/*.png` dan
 * `public/favicon.ico`.
 *
 * Usage:
 *   pnpm gen:pwa-icons
 *
 * Prasyarat:
 *   - source: public/brand/controldesk-logo-mark.png (1024x1024 min).
 *   - devDep: sharp (sudah dipasang).
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const SOURCE = path.join(REPO_ROOT, "public/brand/controldesk-logo-mark.png");
const OUT_DIR = path.join(REPO_ROOT, "public/icons");

// Brand background utk maskable — must fill the whole tile so Android
// launcher tidak show transparency. Indigo dari tema (rules §4).
const BRAND_BG = { r: 79, g: 70, b: 229, alpha: 1 }; // indigo-600

/**
 * Standard non-maskable icons — logo di tengah, background transparent.
 * Semua PWA lifecycle (browser tab, install prompt, splash screen)
 * pakai ukuran-ukuran ini.
 */
const STANDARD_SIZES = [
  { size: 192, name: "icon-192.png" },
  { size: 256, name: "icon-256.png" },
  { size: 384, name: "icon-384.png" },
  { size: 512, name: "icon-512.png" },
];

/**
 * Maskable icons — logo di safe zone tengah (60% dari canvas), sisanya
 * brand background. Android crops sesuai theme launcher; safe zone
 * memastikan mark tidak ke-clip.
 * Spec: https://web.dev/articles/maskable-icon
 */
const MASKABLE_SIZES = [
  { size: 192, name: "icon-maskable-192.png" },
  { size: 512, name: "icon-maskable-512.png" },
];

/** Apple touch icon — iOS "Add to Home Screen". Selalu 180x180. */
const APPLE_TOUCH_SIZE = 180;

async function ensureOutDir() {
  await mkdir(OUT_DIR, { recursive: true });
}

async function generateStandard() {
  for (const { size, name } of STANDARD_SIZES) {
    const outPath = path.join(OUT_DIR, name);
    await sharp(SOURCE)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, quality: 90 })
      .toFile(outPath);
    console.log(`  ✓ ${name} (${size}x${size})`);
  }
}

async function generateMaskable() {
  for (const { size, name } of MASKABLE_SIZES) {
    // Safe zone 60% — resize logo ke 60% canvas, composite ke bg penuh.
    const inner = Math.round(size * 0.6);
    const logoBuf = await sharp(SOURCE)
      .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const outPath = path.join(OUT_DIR, name);
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: BRAND_BG,
      },
    })
      .composite([
        {
          input: logoBuf,
          gravity: "center",
        },
      ])
      .png({ compressionLevel: 9, quality: 90 })
      .toFile(outPath);
    console.log(`  ✓ ${name} (${size}x${size} maskable, safe-zone 60%)`);
  }
}

async function generateAppleTouch() {
  const outPath = path.join(OUT_DIR, "apple-touch-icon.png");
  // iOS clips ke rounded rect + no transparency support di splash,
  // jadi kita fill brand bg + logo di safe zone.
  const inner = Math.round(APPLE_TOUCH_SIZE * 0.7);
  const logoBuf = await sharp(SOURCE)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: APPLE_TOUCH_SIZE,
      height: APPLE_TOUCH_SIZE,
      channels: 4,
      background: BRAND_BG,
    },
  })
    .composite([{ input: logoBuf, gravity: "center" }])
    .png({ compressionLevel: 9, quality: 90 })
    .toFile(outPath);
  console.log(`  ✓ apple-touch-icon.png (${APPLE_TOUCH_SIZE}x${APPLE_TOUCH_SIZE})`);
}

async function generateFavicon() {
  // Modern browser prefer .png/.svg via <link rel="icon" sizes>. Kita
  // generate PNG-multi (32, 16) + biarkan sharp handle .ico kompatibilitas.
  // Sharp tidak native ke .ico, jadi kita output .png saja utk /icon.png
  // Next.js akan expose via /favicon.ico kalau file favicon.ico ada di
  // /app atau /public. Untuk simplicity, kita generate 32x32 favicon.png
  // dan biarkan browser resolve automatically.
  const paths = [
    { size: 16, name: "favicon-16.png" },
    { size: 32, name: "favicon-32.png" },
    { size: 48, name: "favicon-48.png" },
  ];
  for (const { size, name } of paths) {
    const outPath = path.join(OUT_DIR, name);
    await sharp(SOURCE)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, quality: 90 })
      .toFile(outPath);
    console.log(`  ✓ ${name} (${size}x${size})`);
  }
}

async function main() {
  console.log("[gen:pwa-icons] source:", SOURCE);
  console.log("[gen:pwa-icons] out   :", OUT_DIR);
  await ensureOutDir();
  console.log("\n[standard icons]");
  await generateStandard();
  console.log("\n[maskable icons]");
  await generateMaskable();
  console.log("\n[apple touch icon]");
  await generateAppleTouch();
  console.log("\n[favicon]");
  await generateFavicon();
  console.log("\n✓ Done.");
}

main().catch((err) => {
  console.error("✗ generate-pwa-icons failed:", err);
  process.exit(1);
});
