# E2E playbook

Panduan operasional lengkap Playwright untuk QA / Tester. Dari zero
setup sampai debug flake production.

## TL;DR — first-time setup

```bash
# 1. Prerequisites (satu kali).
brew install node@22 pnpm supabase/tap/supabase
corepack enable

# 2. Clone + install (satu kali).
git clone git@github.com:bontiharyanto/controldesk.git
cd controldesk
pnpm install

# 3. Install Playwright browsers (satu kali).
pnpm exec playwright install --with-deps chromium

# 4. Boot Supabase local + seed (per session dev).
pnpm db:start
pnpm db:reset

# 5. Run E2E — akan auto-boot Next.js dev.
pnpm test:e2e
```

Kalau semua step di atas mulus, Anda siap. Kalau ada masalah, lompat
ke [Troubleshooting setup](#troubleshooting-setup).

## Table of contents

- [Prerequisites detail](#prerequisites-detail)
- [Running the suite](#running-the-suite)
- [Debug workflow](#debug-workflow)
- [Reading trace + report](#reading-trace--report)
- [Extending tests](#extending-tests)
- [Selector best practices](#selector-best-practices)
- [Serial vs parallel](#serial-vs-parallel)
- [CI vs local differences](#ci-vs-local-differences)
- [Troubleshooting setup](#troubleshooting-setup)

## Prerequisites detail

### Software versions

| Tool             | Minimum       | Check                         |
| ---------------- | ------------- | ----------------------------- |
| Node.js          | 22.0.0        | `node --version`              |
| pnpm             | 9.12.0        | `pnpm --version`              |
| Supabase CLI     | 2.20.0        | `supabase --version`          |
| Docker           | 24.0.0        | `docker info`                 |
| Playwright       | 1.55.x (from `package.json`) | `pnpm exec playwright --version` |

### Environment variables

Copy `.env.local.example` → `.env.local`. Minimum yang diperlukan
untuk E2E:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste dari `supabase status`>
SUPABASE_SERVICE_ROLE_KEY=<paste dari `supabase status`>
APP_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
CRON_SECRET=dev-cron-secret
NEXT_PUBLIC_APP_URL=http://demo.localhost:3000
```

Detail: [`../env-reference.md`](../env-reference.md).

### macOS / Linux / Windows subdomain routing

- **macOS + Linux**: `*.localhost` → `127.0.0.1` out of the box.
- **Windows tanpa WSL**: edit `C:\Windows\System32\drivers\etc\hosts`:
  ```
  127.0.0.1  demo.localhost
  127.0.0.1  acme.localhost
  ```
- **Cross-check**: `ping demo.localhost` harus balas `127.0.0.1`.

## Running the suite

### Full suite

```bash
pnpm test:e2e
```

Turnaround lokal: ~5-8 menit (Next.js dev server cold compile untuk
setiap route pertama kali kena hit).

### Subset by name pattern

```bash
# All test yang match "cash advance"
pnpm test:e2e -g "cash advance"

# All test di file spesifik
pnpm test:e2e e2e/cash-advance-chain.spec.ts

# Kombinasi file + name
pnpm test:e2e e2e/hr-leave-chain.spec.ts -g "supervisor"
```

### Playwright UI mode (interactive)

```bash
pnpm test:e2e --ui
```

UI mode buka aplikasi Playwright yang:
- Show pohon test.
- Live watch mode — save file → re-run test.
- Time-travel trace viewer — scrub frame by frame.
- Locator picker — hover element untuk lihat selector suggestions.

**Best tool untuk debug** — pakai ini sebelum `console.log`-driven approach.

### Against existing dev server

Kalau `pnpm dev` sudah jalan di terminal lain:

```bash
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm test:e2e
```

Faster iteration — no re-boot per test run.

### Against staging / production build

```bash
# Test against staging (setelah build + start).
PLAYWRIGHT_BASE_URL=https://staging.controldesk.app \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
pnpm test:e2e

# Test against local production build (mimic CI).
pnpm build
pnpm start &
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm test:e2e
kill %1
```

### Headed mode (lihat browser)

```bash
pnpm test:e2e --headed
```

Browser Chromium terbuka visible — lambat + noisy tapi kadang perlu
untuk debug flow visual (mis. animation timing).

### Slow-mo mode

```bash
pnpm test:e2e --headed --slow-mo=500
```

Delay 500ms antar action — human-readable pace.

### Single browser project (CI standard)

```bash
pnpm test:e2e --project=chromium
```

Kita cuma punya 1 project (chromium desktop) — flag ini eksplisit
tapi tidak mengubah apa-apa saat ini.

## Debug workflow

### Step 1: reproduce lokal

```bash
pnpm db:reset                          # clean slate
pnpm test:e2e -g "<test name>"         # narrow scope
```

Kalau **fail lokal**, langsung ke Step 2.
Kalau **pass lokal tapi fail CI** — probably flake. Lihat [`flake-triage.md`](flake-triage.md).

### Step 2: run with UI mode

```bash
pnpm test:e2e --ui -g "<test name>"
```

Di UI:
1. Klik test yang fail.
2. Klik step yang error — trace viewer buka.
3. Scrub timeline — lihat DOM state saat error.
4. **Locator tab** — hover element, tools suggest selector.
5. **Actions tab** — semua action yang dilakukan (`click`, `fill`, `waitForURL`).

### Step 3: baca trace (kalau UI tidak cukup)

Kalau failure hanya reproduce di CI:

```bash
# Download artifact dari GitHub Actions run.
gh run download <run-id> --name playwright-report

# Extract + open.
cd playwright-report
open index.html
```

Trace viewer di HTML report punya fitur sama seperti UI mode.

### Step 4: attach debugger

Kalau butuh breakpoint di test code:

```bash
PWDEBUG=1 pnpm test:e2e -g "<test name>"
```

Ini launch Playwright Inspector — browser + step-by-step control.
Test code jalan sampai `page.pause()` atau end.

Untuk breakpoint eksplisit di test:

```ts
test("my test", async ({ page }) => {
  await page.goto("/dashboard");
  await page.pause();   // ← browser paused, inspector active
  await page.getByRole("button", { name: /submit/i }).click();
});
```

### Step 5: verbose logs

```bash
DEBUG=pw:api pnpm test:e2e -g "<test name>"   # Playwright API calls
DEBUG=pw:browser* pnpm test:e2e -g "<test>"   # Browser stdout/stderr
```

Overkill untuk kebanyakan case tapi berguna untuk isu network /
protocol.

### Step 6: verifikasi di DB

Kalau test check bahwa "row di-insert" tapi assertion UI tidak fire,
verify manual di Supabase Studio:

```bash
supabase status
# → visit http://127.0.0.1:54323 (Studio)
# → query the table
```

Atau via `psql`:

```bash
docker exec -it supabase_db_controldesk psql -U postgres -d postgres
```

Query row yang seharusnya berubah state, cross-ref dengan `security_audit_logs`
untuk lihat siapa yang bertindak.

## Reading trace + report

### Playwright HTML report

Setiap `pnpm test:e2e` output ke `playwright-report/index.html`.
Struktur:

```
playwright-report/
├── index.html                    # ← main dashboard
├── data/
│   ├── <test-id>/
│   │   ├── trace.zip             # ← full trace (open with npx playwright show-trace)
│   │   ├── screenshot.png        # only-on-failure
│   │   ├── video.webm            # only-on-failure
│   │   └── error-context.md
```

### Membuka trace standalone

```bash
pnpm exec playwright show-trace playwright-report/data/<test-id>/trace.zip
```

Trace viewer punya:

- **Timeline**: setiap action di plot vs waktu. Klik → time-travel.
- **Actions**: log setiap Playwright API call.
- **Network**: HTTP request/response.
- **Source**: source code test di step tersebut.
- **Console**: browser console.log.
- **DOM snapshot**: klik "Before" / "After" untuk lihat DOM saat action.

**Skill wajib QA**: bisa baca trace.zip. Latihan dengan fail test
sengaja sekali → open trace → temukan root cause.

### GitHub Actions artifact

Kalau CI fail:

1. Buka run di GitHub Actions.
2. Scroll ke bawah → **Artifacts** section.
3. Download `playwright-report`.
4. Unzip, open `index.html`.

Retensi artifact: **14 hari** (setelah itu di-purge otomatis).

## Extending tests

### Kapan tambah E2E test baru?

**Boleh tambah** kalau:
- Menambah **critical business flow** baru (mis. new approval chain).
- Menambah **new role gating** yang perlu diverifikasi end-to-end.
- Menambah **cross-tenant isolation surface** (mis. new portal feature).
- Regression yang tidak bisa dicover Vitest (butuh browser + server + DB).

**JANGAN tambah** kalau:
- Bug logic murni yang bisa di-cover Vitest (state machine, validation).
- UI styling / animation only.
- Enum edge case → Vitest cukup.
- Field validation error → Vitest schema test cukup.

### Skeleton test file

Copy `e2e/cash-advance-chain.spec.ts` sebagai starter. Struktur:

```ts
import { expect, test } from "@playwright/test";
import { loginAs } from "./fixtures";

/**
 * <Module> chain E2E (rules §<X>).
 *
 * Seeded rows (supabase/seed.sql §<Y>):
 *   • <ROW_ID>: <description>, initial state <STATE>.
 *
 * Chain walked:
 *   1. Actor A → transition to <NEXT_STATE>
 *   2. Actor B → transition to <NEXT_STATE>
 *   ...
 *
 * Denial coverage:
 *   • Role X cannot see button Y at any state.
 *
 * Serial — re-run requires `pnpm db:reset`.
 */

const RESOURCE_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const RESOURCE_URL = `/module/resource/${RESOURCE_ID}`;

test.describe.configure({ mode: "serial" });

test.describe("<module> approval chain", () => {
  test("Step 1: Role approves L1", async ({ page }) => {
    await loginAs(page, "supervisor");
    await page.goto(RESOURCE_URL);

    await expect(
      page.getByText(/pending .*l1|supervisor/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^(approve|setujui)$/i }).click();
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.getByRole("button", { name: /confirm approve|konfirmasi/i }).click(),
    ]);

    await expect(
      page.getByText(/pending .*l2/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ... more steps
});

test.describe("<module> access-control denials", () => {
  test("Employee cannot see Approve on their own submission", async ({ page }) => {
    await loginAs(page, "employee");
    await page.goto(RESOURCE_URL);
    await expect(
      page.getByRole("button", { name: /^(approve|setujui)$/i }),
    ).toHaveCount(0);
  });
});
```

### Checklist sebelum PR

- [ ] Docstring di top file — apa yang di-test + prasyarat seed.
- [ ] `test.describe.configure({ mode: "serial" })` kalau chain suite.
- [ ] Semua approver di chain di-test (positive path).
- [ ] Minimum 1 access-control denial test (negative path).
- [ ] Selector pakai `getByRole` / `getByText` regex ID/EN, **not**
  CSS classname.
- [ ] Timeout eksplisit untuk assertion di RSC route yang cold-compile
  (`toBeVisible({ timeout: 10_000 })`).
- [ ] Update `e2e/README.md` daftar suite kalau serial.
- [ ] Update `docs/qa/test-catalog.md` mapping.
- [ ] Kalau butuh seed baru → update `supabase/seed.sql` di PR yang sama.
- [ ] Kalau butuh `data-testid` baru → tambah di component source, jangan pakai CSS classname.

## Selector best practices

Order preference (dari paling stabil ke paling brittle):

### 1. Role + accessible name (PALING STABIL)

```ts
page.getByRole("button", { name: /approve/i });
page.getByRole("heading", { level: 1, name: /dashboard/i });
page.getByRole("link", { name: /cash advances/i });
page.getByRole("textbox", { name: /email/i });     // <input aria-label> / <FormLabel>
page.getByRole("dialog", { name: /confirm/i });
```

**Kenapa stabil**: ARIA role + accessible name = kontrak accessibility.
Kalau berubah, itu breaking change WCAG (bug) yang harus di-fix.

### 2. `data-testid`

```ts
page.getByTestId("approval-chain-progress");
```

Di source component:
```tsx
<div data-testid="approval-chain-progress">...</div>
```

**Kapan pakai**: kalau element tidak punya semantic role (mis. wrapper
div) atau accessible name terlalu dinamik (mis. angka progress).

**Konvensi naming**:
- kebab-case.
- Prefix domain + entity + purpose: `expense-detail-approve-btn`,
  `client-list-empty-state`, `portal-bell-badge`.
- **Never** guarding presentation-only: JANGAN `red-button` atau `top-navbar-3rd-item`.

### 3. Text content (dwibahasa!)

```ts
page.getByText(/pending .*l1|supervisor/i);       // regex ID + EN
page.getByText(/^disbursed$|dicairkan$/i);         // exact match, kedua bahasa
```

**Kenapa dwibahasa**: user bisa toggle `NEXT_LOCALE` cookie. Test
harus resilient di keduanya.

### 4. Label association

```ts
page.getByLabel(/email/i);      // <label> for <input>
```

**Kaveat Shadcn**: `FormLabel` kadang tidak dihubungkan ke `input`
kalau ada placeholder — `getByLabel` gagal. Pakai `getByRole("textbox",
{ name: /email/i })` atau fallback ke `page.locator('input[type="email"]')`.

### 5. CSS locator (LAST RESORT)

```ts
page.locator('input[type="email"]').first();
page.locator('.rounded-full').nth(2);      // 🚫 fragile — DILARANG
```

**Aturan**: hanya boleh kalau (1) `getByRole` / `getByTestId` /
`getByText` semua gagal ATAU (2) selecting by attribute yang stable
(mis. `input[type=email]`). **JANGAN pakai class Tailwind sebagai
selector** — itu tak pernah stabil.

### 6. First / last / nth

```ts
page.getByRole("button", { name: /approve/i }).first();
```

**Kaveat**: `.first()` OK kalau kita yakin ordering deterministic.
Tapi kalau ada `<button>Approve</button>` di sidebar + dialog + toast,
`.first()` pick yang tidak Anda mau. Prefer scoping:

```ts
const dialog = page.getByRole("dialog", { name: /confirm/i });
await dialog.getByRole("button", { name: /approve/i }).click();
```

### Debugging bad selectors

```ts
// Temporary — cek berapa banyak match.
console.log(await page.getByRole("button", { name: /approve/i }).count());
```

Kalau match > 1 tapi Anda ekspek 1 — scope selector. Kalau match = 0
tapi Anda ekspek ≥ 1 — verify dengan UI mode locator picker.

## Serial vs parallel

### Default: parallel

`playwright.config.ts` set `fullyParallel: true`. Setiap test file
dijalankan **paralel** dengan yang lain (default worker count = CPU).

**Kandidat parallel**:
- `auth-login.spec.ts` — self-contained.
- `landing.spec.ts` — public marketing.
- `approvals-inbox.spec.ts` — read-only view.
- `handovers.spec.ts` — read-only view.
- Access-control denial tests (non-mutating).

### Serial: chain suites

Wrap `test.describe.configure({ mode: "serial" })` di top file kalau:

- Test **mutate seeded data** (approve → state berubah).
- Test **depend on previous test's outcome** (Supervisor approve dulu,
  baru PM bisa approve).
- Test **share resources** (same CA ID, same project).

Serial suites yang landing:
- `cash-advance-chain.spec.ts`
- `petty-cash-chain.spec.ts`
- `hr-requests-chain.spec.ts`
- `hr-leave-chain.spec.ts`
- `pm-handover-chain.spec.ts`
- `weekly-timesheet.spec.ts`
- `canonical-cash-advance.spec.ts`

### Trade-off

Parallel ⇒ faster CI, tapi tidak boleh share state.
Serial ⇒ can chain state, tapi total waktu = sum step (bukan max).

**Aturan praktis**:
- Chain suite (walk approval chain) → serial.
- Isolation test (verifikasi role X tidak lihat data role Y) → parallel.
- Realtime test (bell updates, inbox refreshes) → parallel dengan cleanup di afterEach.

## CI vs local differences

Yang berbeda antara `pnpm test:e2e` di laptop Anda vs GitHub Actions:

| Aspek                | Local                                | CI                                              |
| -------------------- | ------------------------------------ | ----------------------------------------------- |
| Server               | `pnpm dev` (Turbopack, cold compile) | `pnpm start` (production build)                 |
| Workers              | Default (CPU count)                  | **1 worker** (mengurangi flake)                 |
| Retries              | 0                                    | 2                                               |
| Reporter             | `list` + `html`                      | `github` + `html`                               |
| Screenshot           | Only on failure                      | Only on failure                                 |
| Video                | Retain on failure                    | Retain on failure                               |
| Trace                | Retain on failure                    | Retain on failure                               |
| Supabase             | Local `supabase start` (persist)     | Local `supabase start` (fresh per run)          |
| DB seed              | Manual `pnpm db:reset` (persist)     | Automatic per run                               |
| Cold compile risk    | High (first hit slow)                | None (production bundle already compiled)       |
| Realtime jitter      | Standard                             | Same infra, sometimes runner-dependent          |

**Implikasi**: sometimes test **pass lokal, fail CI** karena:
- CI production build catches static import errors yang dev server toleran.
- CI runs 1 worker berurutan → race condition antar test lebih exposed.
- Retry mask real flake — check kalau retry count > 0 di report.

## Troubleshooting setup

### `supabase start` gagal — Docker daemon not reachable

```
Cannot connect to the Docker daemon at unix:///var/run/docker.sock.
```

**Fix**:
- macOS: buka Docker Desktop / `colima start`.
- Linux: `sudo systemctl start docker`.
- Verify: `docker info` harus print daemon line.

### `pnpm db:reset` hang di "Applying migrations"

Kemungkinan migration syntax error atau `pgcrypto` extension belum ready.

**Fix**:
```bash
supabase logs db                       # cek error message
supabase stop --no-backup && pnpm db:start && pnpm db:reset
```

Kalau berlanjut, kill semua container Supabase:
```bash
docker ps -a | grep supabase_
docker rm -f $(docker ps -aq --filter "name=supabase_")
supabase start                         # fresh boot
```

### Playwright browser tidak ke-install

```
Error: browserType.launch: Executable doesn't exist at .../chromium-XXXX/chrome-linux/chrome
```

**Fix**:
```bash
pnpm exec playwright install --with-deps chromium
```

### Login fail — "Login failed" alert di UI

Seeded user tidak match apa yang test expect. Check:

```bash
# Verify seed applied.
docker exec -i supabase_db_controldesk psql -U postgres -d postgres <<'EOF'
SELECT email, role FROM public.employees WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug='demo');
EOF
```

Harus print 11 row (admin, gm, hm, om, pm, pm2, supervisor, employee, finance, hr, pettycash).

Kalau kosong / kurang: `pnpm db:reset` ulang.

### `demo.localhost` tidak resolve

```bash
ping demo.localhost                    # harus 127.0.0.1
```

Kalau timeout:
- **macOS/Linux**: reboot jaringan atau flush DNS (`sudo dscacheutil -flushcache` di macOS).
- **Windows**: edit `hosts` file (lihat [Prerequisites detail](#prerequisites-detail)).

### Test hang di `waitForURL`

Kemungkinan:
1. Next.js dev server crash / restart di tengah test. Cek terminal `pnpm dev` untuk error.
2. Route yang di-tunggu return 500 → check browser network di UI mode.
3. Redirect loop (bug proxy) → check `src/proxy.ts` recent changes.

### Semua test suddenly fail — "TENANT_UNKNOWN"

Kemungkinan `proxy.ts` di root project (bukan `src/proxy.ts`). Next.js
16 dengan Turbopack mengharuskan proxy di `src/` di project ini.

```bash
ls src/proxy.ts                        # harus ada
ls proxy.ts 2>/dev/null                # harus TIDAK ada (di root)
```

## Where to look next

- Untuk memahami apa yang di-test: [`test-catalog.md`](test-catalog.md).
- Setup seed + fixtures: [`test-data.md`](test-data.md).
- Kalau ada flake: [`flake-triage.md`](flake-triage.md).
- Manual smoke: [`manual-smoke-scripts.md`](manual-smoke-scripts.md).
