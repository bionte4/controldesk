import { expect, test } from "@playwright/test";

import { loginAs } from "./fixtures";

/**
 * Smoke test for the in-app Knowledge Base at `/help`.
 *
 * Coverage:
 *   1. `/help` is reachable by any authenticated role (employee is
 *      the lowest — if they can get in, everyone can).
 *   2. Category cards render with real article links from the
 *      manifest — proves the RSC loader can read files from `docs/`.
 *   3. Client-side search returns results for a common query.
 *   4. Deep-linking to a specific article works and shows body content.
 *
 * We use `employee` because rules §6 mandates that help is a
 * universal capability. If we ever regress and gate the route by
 * role, this test fails first.
 */
test.describe("Help center — knowledge base", () => {
  test("employee can browse categories and open an article", async ({
    page,
  }) => {
    await loginAs(page, "employee");
    await page.goto("/help");

    // Header renders with the localised title (id.json default).
    await expect(
      page.getByRole("heading", { level: 1 }),
    ).toContainText(/Bantuan|Help/);

    // Search input is accessible via role="searchbox".
    const search = page.getByRole("searchbox");
    await expect(search).toBeVisible();

    // At least one category card + one article link is rendered.
    // "Apa itu ControlDesk?" is the first pinned article in the manifest.
    const overviewLink = page.getByRole("link", {
      name: /Apa itu ControlDesk/i,
    });
    await expect(overviewLink).toBeVisible();

    // Deep-link to an article — proves generateStaticParams + the
    // markdown loader render the body server-side.
    await overviewLink.click();
    await expect(page).toHaveURL(/\/help\/overview/);
    await expect(
      page.getByRole("heading", { level: 1, name: /Apa itu ControlDesk/i }),
    ).toBeVisible();
    // Body content — the article talks about "multi-tenant" somewhere
    // in the first few paragraphs.
    await expect(page.getByText(/multi-tenant/i).first()).toBeVisible();

    // Back link takes us to the index.
    await page.getByRole("link", { name: /Kembali|Back to/i }).click();
    await expect(page).toHaveURL(/\/help$/);
  });

  test("search filters results as the user types", async ({ page }) => {
    await loginAs(page, "employee");
    await page.goto("/help");

    const search = page.getByRole("searchbox");
    // "approval" is a keyword that appears in multiple manifest articles.
    await search.fill("approval");

    // The results region uses aria-live="polite".
    const results = page.getByRole("region", {
      name: /Hasil pencarian|Search results/i,
    });
    await expect(results).toBeVisible();
    // At least one result link visible in the results region.
    await expect(results.getByRole("link").first()).toBeVisible();
  });

  test("Ask AI tab shows welcome + input when opened via ?tab=ask", async ({
    page,
  }) => {
    await loginAs(page, "employee");
    // Deep-link straight into the chat tab — the RSC page honours
    // `?tab=ask` as the initial selected tab.
    await page.goto("/help?tab=ask");

    // Welcome card is rendered before the user sends anything.
    await expect(
      page.getByText(/asisten dokumentasi ControlDesk|documentation assistant/i),
    ).toBeVisible();
    // Composer textarea is present and enabled.
    const composer = page.getByRole("textbox");
    await expect(composer).toBeVisible();
    await expect(composer).toBeEnabled();
  });

  test("Ask AI history sidebar hits the conversations API on mount", async ({
    page,
  }) => {
    await loginAs(page, "employee");

    // Wait for the sidebar's initial GET before the tab renders any
    // content — this proves the client wires the history endpoint on
    // mount even in the empty state, without needing a real LLM
    // configured for the tenant.
    const historyRequest = page.waitForRequest(
      (req) =>
        req.url().includes("/api/help/conversations") &&
        req.method() === "GET",
    );
    await page.goto("/help?tab=ask");
    const req = await historyRequest;
    expect(req.method()).toBe("GET");

    // Sidebar renders with the "New conversation" button. The
    // aria-label on the aside comes from the localised history.title.
    const sidebar = page.getByRole("complementary", {
      name: /Riwayat percakapan|Recent conversations/i,
    });
    await expect(sidebar).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: /Percakapan baru|New conversation/i }),
    ).toBeVisible();
  });
});
