import { chromium } from "@playwright/test";

const port = process.env.PORT || "3000";
const label = process.env.LABEL || "";
const shots = [
  { name: `${label}desktop-dark`, w: 1440, h: 900, scheme: "dark" },
  { name: `${label}tablet-portrait-dark`, w: 820, h: 1180, scheme: "dark" },
  { name: `${label}mobile-dark`, w: 390, h: 844, scheme: "dark" },
];

const browser = await chromium.launch({
  args: ["--disable-application-cache", "--disk-cache-size=1"],
});
for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: 2,
    extraHTTPHeaders: {
      "Cache-Control": "no-cache",
    },
  });
  await ctx.addCookies([
    {
      name: "theme",
      value: s.scheme,
      domain: "demo.localhost",
      path: "/",
      httpOnly: false,
    },
    {
      name: "NEXT_LOCALE",
      value: "id",
      domain: "demo.localhost",
      path: "/",
      httpOnly: false,
    },
  ]);
  await ctx.addCookies([
    {
      name: "theme",
      value: s.scheme,
      domain: "localhost",
      path: "/",
      httpOnly: false,
    },
  ]);
  const page = await ctx.newPage();
  await page.emulateMedia({ colorScheme: s.scheme });
  await page.goto(`http://demo.localhost:${port}/login?v=${Date.now()}`, {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: `/tmp/auth-${s.name}.png`,
    fullPage: false,
  });
  await ctx.close();
  console.log(`captured ${s.name} (${s.w}x${s.h})`);
}
await browser.close();
