import { chromium } from "@playwright/test";

const sizes = [
  { name: "desktop-1440x900", w: 1440, h: 900 },
  { name: "desktop-1280x720", w: 1280, h: 720 },
  { name: "tablet-1024x768", w: 1024, h: 768 },
  { name: "tablet-portrait-820x1180", w: 820, h: 1180 },
  { name: "tablet-narrow-768x1024", w: 768, h: 1024 },
  { name: "mobile-390x844", w: 390, h: 844 },
  { name: "mobile-se-375x667", w: 375, h: 667 },
  { name: "mobile-tiny-360x640", w: 360, h: 640 },
];

const browser = await chromium.launch();
for (const s of sizes) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h },
  });
  const page = await ctx.newPage();
  await page.goto("http://demo.localhost:3000/login", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(800);
  const metrics = await page.evaluate(() => ({
    docHeight: document.documentElement.scrollHeight,
    docWidth: document.documentElement.scrollWidth,
    viewportH: window.innerHeight,
    viewportW: window.innerWidth,
  }));
  const overflowY = metrics.docHeight - metrics.viewportH;
  const overflowX = metrics.docWidth - metrics.viewportW;
  const status =
    overflowY <= 1 && overflowX <= 1 ? "✓ fits" : "✗ overflow";
  console.log(
    `${status.padEnd(11)} ${s.name.padEnd(30)} overflowY=${overflowY}px overflowX=${overflowX}px`,
  );
  await ctx.close();
}
await browser.close();
