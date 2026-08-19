#!/usr/bin/env node

/**
 * Generates a transparent-background variant of the ControlDesk logo
 * mark from `public/brand/controldesk-logo-mark.png` (which ships with
 * a solid white background baked in — required for the maskable-icon
 * PWA safe-zone rules that `scripts/generate-pwa-icons.mjs` consumes).
 *
 * The transparent variant is used by any surface that renders the logo
 * on a dark or colored background where the white square is visible
 * and looks unprofessional — most notably the post-login splash
 * (`src/app/(auth)/login/post-login-splash.tsx`).
 *
 * Algorithm: chroma-key on near-white. Any pixel whose R, G, B channels
 * are ALL above `THRESHOLD` (default 235/255) is written with alpha 0.
 * Colored pixels are preserved exactly — no anti-aliasing on the edge
 * pixels is smoothed, which keeps the gradient inside the shapes crisp
 * without producing a jagged silhouette.
 *
 * Usage:
 *   node scripts/generate-transparent-logo.mjs
 *
 * Idempotent: re-running overwrites the destination file. Commit both
 * the input (opaque) and output (transparent) files so downstream
 * consumers don't need to run this script during install.
 */

import { createRequire } from "node:module";
import { statSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const SRC = resolve("public/brand/controldesk-logo-mark.png");
const DST = resolve("public/brand/controldesk-logo-mark-transparent.png");
const THRESHOLD = 235;

const img = sharp(SRC).ensureAlpha();
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

if (channels !== 4) {
  throw new Error(`expected 4 channels after ensureAlpha, got ${channels}`);
}

const out = Buffer.from(data);
let transparentPixels = 0;
for (let i = 0; i < out.length; i += channels) {
  const r = out[i];
  const g = out[i + 1];
  const b = out[i + 2];
  if (r >= THRESHOLD && g >= THRESHOLD && b >= THRESHOLD) {
    out[i + 3] = 0;
    transparentPixels++;
  }
}

await sharp(out, { raw: { width, height, channels } })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(DST);

const totalPixels = width * height;
const pct = ((transparentPixels / totalPixels) * 100).toFixed(1);
const sizeKB = (statSync(DST).size / 1024).toFixed(1);
console.log(
  `[transparent-logo] ${width}×${height}, ${transparentPixels}/${totalPixels} px (${pct}%) → transparent, ${sizeKB} KB → ${DST}`,
);
