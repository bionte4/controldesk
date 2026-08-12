import { chromium } from "@playwright/test";

const browser = await chromium.launch();
for (const scheme of ["dark", "light"]) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await ctx.addCookies([
    {
      name: "NEXT_LOCALE",
      value: "id",
      domain: "localhost",
      path: "/",
      httpOnly: false,
    },
    {
      name: "theme",
      value: scheme,
      domain: "localhost",
      path: "/",
      httpOnly: false,
    },
  ]);
  const page = await ctx.newPage();
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto("http://localhost:3000/?v=" + Date.now(), {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: `/tmp/marketing-${scheme}.png`,
    fullPage: true,
  });
  console.log("captured", scheme);
  await ctx.close();
}
await browser.close();
