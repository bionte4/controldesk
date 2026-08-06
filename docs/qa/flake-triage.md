# Flake triage playbook

Flake = test yang **kadang pass, kadang fail** dengan input yang sama.
Ini kanker CI karena:

1. **Devs abaikan CI** — "ah cuma flake, retry aja" — sampai real bug tembus.
2. **Trust erodes** — signal-to-noise turun → PR review lambat.
3. **Cost naik** — CI minutes habis untuk retry.

**Policy**: **zero-tolerance untuk flake**. Setiap flake yang muncul
di CI wajib difile issue + di-triage dalam 48 jam.

## Detecting flake

### CI retry indicator

`playwright.config.ts` set `retries: 2` di CI. Kalau test pass di attempt 2 atau 3, itu **flake signal** — bukan real failure tapi tidak stabil.

Check retry count di GitHub Actions log:

```
Running 42 tests using 1 worker
  ✘  1 › e2e/cash-advance-chain.spec.ts › supervisor approves L1 (14.2s)
  ↺  2 › e2e/cash-advance-chain.spec.ts › supervisor approves L1 (retry 1)
  ✓  3 › e2e/cash-advance-chain.spec.ts › supervisor approves L1 (retry 2, 8.4s)
```

Kalau ada `↺` (retry) → file flake issue.

### GitHub Actions dashboard

Track flake rate per suite:

```bash
# Query recent CI runs, cari yang ada retry.
gh run list --workflow=e2e.yml --limit=50 --json databaseId,status,conclusion \
  | jq '.[] | select(.conclusion=="success") | .databaseId'
```

Untuk setiap run yang sukses, download playwright-report artifact +
grep untuk "retry".

### Local reproduction

```bash
# Run test 10x untuk cari flake.
for i in $(seq 1 10); do
  echo "=== Run $i ==="
  pnpm test:e2e -g "supervisor approves L1" || echo "FAILED at run $i"
done
```

Kalau > 1 fail dari 10 → confirmed flake.

## Root cause categories

### Category 1: timing-sensitive assertions

**Symptom**: test pass di UI mode (slow) tapi fail di headless (fast).

**Cause**: assertion terlalu cepat — element belum render / state belum settle.

**Example bad**:

```ts
await page.click("Submit");
await expect(page.getByText("Success")).toBeVisible();
// ↑ fail kalau server response > 100ms
```

**Fix**:

```ts
await page.click("Submit");
await expect(page.getByText("Success")).toBeVisible({ timeout: 10_000 });
// ↑ auto-retry sampai 10 detik.
```

Playwright's `expect(...).toBeVisible()` **automatically retries**
sampai timeout. Cukup naikkan timeout kalau operasi lambat.

**Anti-pattern**: `setTimeout` / `page.waitForTimeout(...)` — brittle
dan lambat konsisten:

```ts
// ❌ BAD — jangan pakai fixed delay.
await page.waitForTimeout(2000);
await expect(page.getByText("Success")).toBeVisible();

// ✓ GOOD — biarkan Playwright poll.
await expect(page.getByText("Success")).toBeVisible({ timeout: 10_000 });
```

### Category 2: race condition antar test (parallel)

**Symptom**: test A pass sendirian, fail bersamaan dengan test B.

**Cause**: kedua test mutate resource sama (mis. sama-sama update
project X). Order execution non-deterministic karena parallel.

**Fix**:
- Kalau kedua test mutate → convert ke serial (`test.describe.configure({ mode: "serial" })`).
- Kalau bisa pisah resource → beri test B seed row berbeda.

**Contoh**: Dulu `cash-advance-chain` dan `approvals-inbox` sama-sama
tersentuh CA yang sama → serialkan CA chain.

### Category 3: cold Next.js compile timeout

**Symptom**: test pertama di suite fail dengan `waitForURL timeout`,
tapi test kedua+ sukses.

**Cause**: Next.js dev server compile route on-demand. First hit ke
`/dashboard` bisa > 15 detik.

**Fix**:
- Naikkan timeout `loginAs` fixture (sudah 60 detik).
- Di CI, run against production build (`pnpm start`) — no compile lag.
- Kalau route sangat berat: pre-warm dengan `await page.goto("/dashboard")` di `test.beforeAll`.

Existing `playwright.config.ts` sudah run production build di CI
untuk mitigasi ini.

### Category 4: Supabase Auth session race

**Symptom**: login sukses tapi immediately next navigation return 401.

**Cause**: Supabase Auth session cookie set, tapi proxy hit route
sebelum cookie fully propagate → `getUser()` return null.

**Fix**:
- `await page.waitForURL(...)` sampai bukan `/login` — memastikan
  browser sudah receive Set-Cookie.
- Kalau masih flake, tambah `await page.waitForLoadState("networkidle")`
  setelah waitForURL.

### Category 5: seed drift

**Symptom**: chain suite fail dari test kedua onwards karena state
sudah advanced dari run sebelumnya.

**Cause**: forgot `pnpm db:reset` sebelum re-run chain suite.

**Fix**:
- Selalu `pnpm db:reset` sebelum chain suite lokal.
- Di CI, seed fresh per run — no drift.
- Kalau lokal frequent drift: alias script:
  ```bash
  # Di .zshrc / .bashrc:
  alias pnpm-e2e-clean='pnpm db:reset && pnpm test:e2e'
  ```

### Category 6: realtime subscription timing

**Symptom**: `approvals-inbox` test kadang show old count.

**Cause**: Supabase Realtime channel connect < 1 detik lag. Assertion
fire sebelum channel receive event.

**Fix**:
- Buat mutation di window 1, lalu di window 2 (target test):
  ```ts
  await expect(async () => {
    // Realtime update should eventually arrive.
    const count = await page.getByTestId("inbox-badge").textContent();
    expect(count).toBe("3");
  }).toPass({ timeout: 15_000, intervals: [1_000, 2_000, 3_000] });
  ```

### Category 7: locale drift (ID vs EN)

**Symptom**: test cari text "Approve", tapi UI show "Setujui" (locale ID).

**Cause**: cookie `NEXT_LOCALE` sticky ke locale sebelumnya.

**Fix**: pakai regex dwibahasa selalu:

```ts
await page.getByRole("button", { name: /^(approve|setujui)$/i }).click();
```

Bukan:

```ts
await page.getByRole("button", { name: "Approve" }).click();   // ❌
```

### Category 8: browser cache dari test sebelumnya

**Symptom**: test 1 login as A, test 2 expected fresh session tapi
inherit A's cookies.

**Cause**: default Playwright context TIDAK reset antar test — cookies
persist.

**Fix**: kalau butuh fresh:

```ts
test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});
```

Atau isolated auth state per test:

```ts
test.use({ storageState: { cookies: [], origins: [] } });
```

### Category 9: date-dependent seed

**Symptom**: test pass hari ini, fail besok.

**Cause**: seed pakai `now() - interval '2 days'`, dan test cari row
"submitted 2 days ago" — offset bergeser.

**Fix**:
- Test **tidak boleh** assert absolute date. Assert relative
  ("recently submitted", "within 7 days").
- Atau freeze clock:
  ```ts
  await page.clock.setFixedTime(new Date("2026-08-01T00:00:00Z"));
  ```

Sample seed date drift terlihat di weekly timesheet — solved dengan
`isoMondayOf(new Date())` di test yang hitung week dari now.

### Category 10: dev-only console errors leaking to production build

**Symptom**: pass di `pnpm dev`, fail di CI (`pnpm start`).

**Cause**: React dev warning tidak mempengaruhi rendering tapi Next.js
production build lebih strict — build-time error yang di dev cuma warn.

**Fix**:
- Reproduce lokal via `pnpm build && pnpm start && pnpm test:e2e`.
- Fix underlying issue (e.g. hydration mismatch).

## Triage workflow

### Step 1: log the flake

Immediately setelah observe flake di CI (retry pass):

1. Buka GitHub issue dengan template:

   ```markdown
   Title: [Flake] <spec>: <test name>

   ## Observed
   - CI run: <link>
   - Attempt: 1 fail, 2 pass (retry pass)
   - Duration: <seconds> vs baseline <seconds>

   ## Test
   - File: `e2e/<spec>.spec.ts`
   - Line: <n>
   - Assertion: `<code>`

   ## Suspected category
   [ ] Timing (Category 1)
   [ ] Race condition (Category 2)
   [ ] Cold compile (Category 3)
   [ ] Auth race (Category 4)
   [ ] Seed drift (Category 5)
   [ ] Realtime (Category 6)
   [ ] Locale (Category 7)
   [ ] Cache (Category 8)
   [ ] Date-dependent (Category 9)
   [ ] Prod-only (Category 10)
   [ ] Other: __

   ## Trace
   Download from CI: <link to playwright-report artifact>
   ```

2. Tag `flake` + `qa` label.
3. Assign ke test author atau QA on-call.

### Step 2: reproduce lokal

```bash
# Loop untuk confirm flake rate.
for i in {1..10}; do
  echo "Run $i:"
  pnpm test:e2e -g "<test name>" 2>&1 | grep -E "(✓|✘)" || echo "PARSE FAIL"
done
```

Kalau fail rate ≥ 20 % → definitely flake. < 5 % → mungkin environmental.

### Step 3: identify category

Baca [Root cause categories](#root-cause-categories) — biasanya bisa
klasifikasi dari trace + assertion type.

### Step 4: fix

Sesuai kategori:

| Kategori | Fix pattern                                                          |
| -------- | -------------------------------------------------------------------- |
| 1        | Naikkan timeout di assertion tunggal (bukan global).                 |
| 2        | Serialize suite atau pisah resource.                                 |
| 3        | Pre-warm route atau run against prod build lokal.                    |
| 4        | Tambah `waitForLoadState("networkidle")` setelah login.              |
| 5        | Verify `pnpm db:reset` di setup + document di docstring.             |
| 6        | Wrap assertion di `expect(...).toPass()` retry.                      |
| 7        | Regex dwibahasa `/^(en|id)$/i`.                                      |
| 8        | Clear cookies di `beforeEach` atau isolated storageState.            |
| 9        | Freeze clock atau relative date assertion.                           |
| 10       | Reproduce dengan `pnpm build && pnpm start` lokal.                   |

### Step 5: verify fix

```bash
# Loop 20x lokal — target 0 fail.
for i in {1..20}; do
  pnpm test:e2e -g "<test name>" && echo "PASS $i" || echo "FAIL $i"
done
```

Merge fix hanya kalau 20/20 pass.

### Step 6: monitor post-merge

Setelah merge, watch 5 CI run berikutnya di `main`. Kalau tidak ada
retry lagi → close issue. Kalau retry muncul lagi → reopen + escalate.

## Anti-flake best practices (untuk penulis test baru)

### Do

- ✓ Pakai `await expect(...).toBeVisible({ timeout: N })` dengan explicit timeout.
- ✓ Regex selector dwibahasa: `/^(approve|setujui)$/i`.
- ✓ Scope selector: `dialog.getByRole("button", ...)` bukan global.
- ✓ Serial mode untuk chain yang mutate.
- ✓ `pnpm db:reset` di setup docstring.
- ✓ Deterministic seed IDs.
- ✓ `waitForURL` + `waitForLoadState("networkidle")` setelah nav.

### Don't

- ✘ `page.waitForTimeout(2000)` — fixed delay = brittle.
- ✘ `.first()` / `.last()` tanpa scope — non-deterministic pick.
- ✘ CSS classname sebagai selector — Tailwind class berubah tiap iterasi.
- ✘ Assume test order — pakai serial mode kalau depend.
- ✘ Hardcode absolute date — pakai relative atau freeze clock.
- ✘ Rely pada `console.log` sebagai debug — trace + UI mode lebih akurat.

## Quarantine policy

Kalau flake **tidak bisa fix dalam 48 jam**:

1. Tag test dengan `test.fixme(...)` bukan `test.skip(...)` — masih track.
2. File issue dengan label `flake-quarantined`.
3. Assign SLA fix maksimum **7 hari**.
4. Kalau > 7 hari tanpa fix, escalate ke QA Lead untuk decide:
   - Delete test (kalau coverage bisa direplace unit).
   - Rewrite test (redesign fixture / assertion).
   - Accept + document (rare — hanya untuk environmental limitation).

Contoh:

```ts
test.fixme("supervisor approves L1", async ({ page }) => {
  // TODO(#123): flake at CI. Cold compile timeout > 60s intermittent.
  // Reproduce with prod build lokal untuk validate fix.
  await loginAs(page, "supervisor");
  // ...
});
```

## Metrics + monitoring

QA Lead track flake metrics weekly:

| Metric                             | Target                                | Alert threshold                     |
| ---------------------------------- | ------------------------------------- | ----------------------------------- |
| CI retry rate (E2E)                | < 2 %                                 | > 5 % — escalate                    |
| Time-to-fix flake                  | < 48 jam                              | > 7 hari — quarantine               |
| Quarantined tests count            | < 3                                   | > 5 — freeze new tests until clear  |
| Real bug caught via retry pass     | 0                                     | ≥ 1 — regression                    |

Dashboard: GitHub Actions insights + custom script di `scripts/flake-report.ts` (planned).

## Where to look next

- Cara reproduce + debug → [`e2e-playbook.md#debug-workflow`](e2e-playbook.md#debug-workflow).
- Trace viewer → [`e2e-playbook.md#reading-trace--report`](e2e-playbook.md#reading-trace--report).
- Bug filing → [`bug-reporting.md`](bug-reporting.md).
