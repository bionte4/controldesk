# Test data & fixtures

Panduan lengkap tentang **seed data**, **demo users**, **fixture
patterns**, dan **isolation contracts** yang membuat E2E deterministic
dan Vitest tetap murni.

## Prinsip

1. **Deterministic** — same input, same output. No random data yang tidak reproducible.
2. **Idempotent** — `pnpm db:reset` bisa dijalankan berapa kali pun, hasil sama.
3. **Isolated** — Vitest never touch DB; Playwright never share state antara test paralel.
4. **Realistic** — data cerminkan skenario nyata (multi-project client, multi-role hierarchy, contoh nominal masuk akal).

## Seed data structure

Source: [`supabase/seed.sql`](../../supabase/seed.sql) (~1500 baris).
Applied oleh `pnpm db:reset` bersama dengan semua migrations.

Struktur dokumen seed (dengan section header di file):

```
0. Idempotency wipe
1. Demo tenant (slug='demo')
2. Helper function: create_confirmed_auth_user()
3. Users + employees (11 internal role users)
4. Clients + BPO contracts + projects + assignments + budgets
5. HR requests (5 request seed di berbagai state)
6. Cash Advances (6 CA seed — pending, disbursed, settled)
7. Petty Cash (1 fund + vouchers + replenishments)
8. PM Handover (2 handover seed)
9. Shifts + rosters + timesheets
10. Weekly timesheet packets
11. Client portal users (3 client users — active, active-other, pending)
12. Portal notifications (seed some for portal.spec.ts)
```

## Demo tenant

Semua seed data hidup di satu tenant `demo`:

```sql
INSERT INTO public.tenants (id, slug, name)
VALUES ('11111111-1111-4111-8111-111111111111', 'demo', 'Demo Company');
```

**Subdomain lokal**: `http://demo.localhost:3000`.

Kalau butuh test multi-tenant (mis. verify cross-tenant guard), tambah
tenant kedua di seed dengan pattern yang sama. Tapi keep multi-tenant
seed minimal — cross-tenant test biasanya cukup dengan integration
test bukan E2E.

## Demo users (11 internal + 3 portal)

**Password universal**: `ControlDesk#2026`.

### Internal employees (login via `/login`)

| Slug          | Email                                | Name                | Role (legacy)          | Role (canonical)|
| ------------- | ------------------------------------ | ------------------- | ---------------------- | --------------- |
| `admin`       | `admin@demo.controldesk.app`         | Ayu Admin           | `TENANT_ADMIN`         | `ADMIN`         |
| `gm`          | `gm@demo.controldesk.app`            | Gita General        | `GENERAL_MANAGER`      | `DIRECTOR`      |
| `hm`          | `hm@demo.controldesk.app`            | Hendra Head         | `HEAD_MANAGER`         | `DIRECTOR`      |
| `om`          | `om@demo.controldesk.app`            | Omar Operations     | `OPERATIONS_MANAGER`   | `OM`            |
| `pm`          | `pm@demo.controldesk.app`            | Putri PM            | `PROJECT_MANAGER`      | `PM`            |
| `pm2`         | `pm2@demo.controldesk.app`           | Prima PM2           | `PROJECT_MANAGER`      | `PM`            |
| `supervisor`  | `supervisor@demo.controldesk.app`    | Sinta Supervisor    | `SUPERVISOR`           | `SUPERVISOR`    |
| `employee`    | `employee@demo.controldesk.app`      | Eko Employee        | `EMPLOYEE`             | `EMPLOYEE`      |
| `finance`     | `finance@demo.controldesk.app`       | Fajar Finance       | `LEAD_FINANCE`         | `FINANCE`       |
| `hr`          | `hr@demo.controldesk.app`            | Hana HR             | `HR_ADMIN`             | `ADMIN`         |
| `pettycash`   | `pettycash@demo.controldesk.app`     | Pandu Petty         | `PETTY_CASH_CUSTODIAN` | `FINANCE`       |

**Reporting chain** (dari rules §4):

```
employee     → supervisor
supervisor   → pm
pm, pm2      → om
om           → hm
hm           → gm
gm           → admin
finance      → admin  (staff, off-ladder)
hr           → admin  (staff, off-ladder)
pettycash    → admin  (staff, off-ladder)
```

### Client portal users (login via `/portal/login`)

| Slug     | Email                                 | Belongs to Client       | Status               | Purpose                                     |
| -------- | ------------------------------------- | ----------------------- | -------------------- | ------------------------------------------- |
| `nusa`   | `client@demo.controldesk.app`         | PT Nusa Digital         | `ACTIVE`             | Happy path portal login + own project view. |
| `indo`   | `client-indo@demo.controldesk.app`    | PT Indo Retail Ceria    | `ACTIVE`             | Cross-client isolation test.                 |
| `newbie` | `client-new@demo.controldesk.app`     | PT Nusa Digital         | `PENDING_ACTIVATION` | Force-change-password flow test.             |

## Demo clients + projects

Untuk exercise 1-client-N-projects rule:

### PT Nusa Digital (`clients.slug = 'nusa'`)

- **NUSA-CS** (id `33333333-1111-4111-8111-111111111111`) — Customer Service BPO managed. Assigned PM: `pm`. Budget total 100 juta.
- **NUSA-DATA** — Data Entry retainer.

### PT Indo Retail Ceria (`clients.slug = 'indo'`)

- **INDO-HELP** (id `33333333-1111-4111-8111-333333333333`) — Help Desk managed. Assigned PM: `pm2`. Budget total 200 juta.

### PT Sejahtera Media (`clients.slug = 'sejahtera'`)

- **SEJAHTERA-FIELD** — Field service one-off.

## Deterministic UUIDs

Seed pakai **structured UUIDs** untuk memudahkan reference di test
files — tidak random `gen_random_uuid()`.

Pattern:

```
XXXXXXXX-YYYY-4YYY-8YYY-ZZZZZZZZZZZZ
│        │    │    │    └── serial (row within kind)
│        │    │    └────── constant (RFC-compliant variant)
│        │    └─────────── constant (version 4 marker)
│        └──────────────── kind marker
└───────────────────────── domain marker
```

| Domain prefix          | Meaning                                |
| ---------------------- | -------------------------------------- |
| `11111111-...`         | Tenants                                |
| `22222222-...`         | Users / employees                      |
| `33333333-...`         | Clients / projects                     |
| `44444444-...`         | Assignments (PM + employee)            |
| `55555555-...`         | HR requests                            |
| `66666666-...`         | Cash advances                          |
| `77777777-...`         | Petty cash                             |
| `88888888-...`         | PM handovers                           |
| `99999999-...`         | Shifts / rosters / timesheets          |

Contoh seed row:

```sql
-- CA_PENDING: Rp 1.5jt, PENDING_L1_SUPERVISOR, ready for E2E chain.
INSERT INTO public.cash_advances (id, ...)
VALUES ('66666666-1111-4111-8111-111111111111', ...);

-- CA_DISBURSED: Rp 4.2jt, sudah DISBURSED, waiting settlement.
INSERT INTO public.cash_advances (id, ...)
VALUES ('66666666-1111-4111-8111-222222222222', ...);
```

Di test:

```ts
const CA_PENDING = "66666666-1111-4111-8111-111111111111";
const CA_DISBURSED = "66666666-1111-4111-8111-222222222222";
```

**Kenapa deterministic UUID**: bisa hardcode di E2E spec tanpa perlu
runtime query "cari CA yang PENDING". Reproducible + debuggable.

## Reset workflow

### Local dev

```bash
# Reset penuh — DROP semua + apply migrations + seed dari nol.
pnpm db:reset

# Verifikasi cepat.
docker exec -i supabase_db_controldesk psql -U postgres -d postgres <<'EOF'
SELECT COUNT(*) FROM public.employees WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
-- expect: 11
SELECT COUNT(*) FROM public.cash_advances;
-- expect: 6
EOF
```

Turnaround: ~30-45 detik.

### Kapan reset wajib

- **Sebelum run serial chain suite** — chain mutate seed state, next run butuh clean.
- **Setelah pull migration baru** dari `main`.
- **Setelah editing seed.sql** untuk tambah demo data.

### Kapan reset NOT wajib

- Test parallel non-mutating (auth-login, landing, approvals-inbox, handovers list, portal isolation view).
- Vitest unit / integration — never touch DB.

## Vitest fixtures

Vitest test **tidak boleh** touch DB. Semua fixture inline atau di
`__fixtures__/*.ts`.

### Inline fixture (preferred untuk 1-2 file)

```ts
// src/lib/expenses/state.test.ts
import { describe, it, expect } from "vitest";
import { transitionExpense } from "./state";

describe("expense state machine", () => {
  const baseExpense = {
    id: "exp-001",
    tenantId: "tenant-A",
    projectId: "proj-A",
    submitterId: "emp-employee",
    amount: 3_000_000,
    status: "DRAFT",
  };

  it("submits DRAFT → PENDING_L1", () => {
    const next = transitionExpense(baseExpense, {
      action: "submit",
      actor: { role: "EMPLOYEE", employeeId: "emp-employee" },
    });
    expect(next.status).toBe("PENDING_L1_SUPERVISOR");
  });
});
```

### Shared fixture (untuk ≥ 3 file reuse)

Convention: `src/lib/{module}/__fixtures__/*.ts`.

```ts
// src/lib/expenses/__fixtures__/expenses.ts
export const draftExpense = {
  id: "exp-draft-001",
  tenantId: "tenant-demo",
  projectId: "proj-nusa-cs",
  submitterId: "emp-employee",
  amount: 3_000_000,
  status: "DRAFT" as const,
  category: "TRANSPORT" as const,
  incurredAt: new Date("2026-08-01"),
  receiptUrl: null,
};

export const pendingL2Expense = {
  ...draftExpense,
  id: "exp-l2-001",
  status: "PENDING_L2_PM" as const,
};
```

Import di test:

```ts
import { draftExpense, pendingL2Expense } from "../__fixtures__/expenses";
```

**Anti-pattern**: JANGAN import dari `supabase/seed.sql` — parser SQL
tidak digunakan runtime, ini hanya SQL string yang di-execute Postgres.

## Playwright fixtures

Source: [`e2e/fixtures.ts`](../../e2e/fixtures.ts).

### `loginAs(page, roleKey)`

Helper terpenting. Signature:

```ts
export async function loginAs(page: Page, role: RoleKey): Promise<void>
```

Behavior:
1. Navigate ke `/login`.
2. Fill email + password (dari `DEMO_USERS[role]`).
3. Click Submit.
4. `waitForURL` sampai bukan `/login` (redirect ke `/dashboard`).
5. Assert URL match `/dashboard`.

Timeout: 60 detik (accommodate Next.js dev server cold compile).

Contoh:

```ts
import { test } from "@playwright/test";
import { loginAs } from "./fixtures";

test("PM approves L2", async ({ page }) => {
  await loginAs(page, "pm");
  await page.goto("/finance/cash-advances/66666666-1111-4111-8111-111111111111");
  // ... test steps
});
```

### `DEMO_USERS`

Constant mapping role → `{ email, name }`. Dipakai kalau test perlu
verify text seperti "Assigned to Putri PM" muncul di UI.

```ts
import { DEMO_USERS } from "./fixtures";

await expect(page.getByText(DEMO_USERS.pm.name)).toBeVisible();
```

### Portal fixtures

`e2e/portal.spec.ts` embeds its own portal login helper (belum
di-extract ke fixtures.ts karena spesifik portal):

```ts
const PORTAL_USERS = {
  nusa: {
    email: "client@demo.controldesk.app",
    clientName: "PT Nusa Digital",
    ownedProjectId: "33333333-1111-4111-8111-111111111111",
    ownedProjectCode: "NUSA-CS",
    otherClientProjectId: "33333333-1111-4111-8111-333333333333",
    otherClientProjectCode: "INDO-HELP",
  },
  indo: { ... },
  newbie: { ... },
};

async function portalLoginAs(page, role) { ... }
```

Kalau spec baru butuh portal login juga, extract ke `e2e/portal-fixtures.ts`.

## Isolation contracts

### Contract 1: Vitest never touches DB

**Enforcement**: `vitest.config.ts` alias `server-only` ke stub. Semua
DB-side module (`src/lib/data/*.ts`, Server Actions) tidak boleh di-run
in Vitest — pakai mock kalau perlu.

Kalau perlu real DB test, itu **Playwright**, bukan Vitest.

### Contract 2: Playwright never mutates cross-test in parallel mode

**Enforcement**: `test.describe.configure({ mode: "serial" })` di setiap
chain suite yang mutate. Documented di [`e2e-playbook.md#serial-vs-parallel`](e2e-playbook.md#serial-vs-parallel).

Kalau spec di parallel suite (`auth-login`, `landing`, dst.) accidentally
mutate state, split ke suite serial atau reset state di `test.beforeEach`.

### Contract 3: Portal data isolation

Client Portal seed setup **PT Nusa** (`client@`) dan **PT Indo**
(`client-indo@`) sebagai two clients terpisah di tenant `demo` untuk
test cross-client isolation. Nusa TIDAK BOLEH lihat proyek Indo.

Test: `portal.spec.ts` verify:
1. Login sebagai `nusa` → dashboard tunjukkan hanya NUSA-CS + NUSA-DATA.
2. Force navigate ke `/portal/projects/{INDO-HELP_id}` → return 404 (bukan project detail).
3. Symmetrical test untuk `indo` login.

### Contract 4: No demo data di production

Production build **tidak** menjalankan `supabase/seed.sql` — hanya
migrations. Ini enforced di deployment pipeline
([`../deployment.md`](../deployment.md)):

- Migration script runs on production DB during deploy.
- Seed script hanya di lokal dev + CI runners.

## Adding new seed data

### Kapan tambah?

- Menambah **new module** yang butuh demo data untuk manual QA + smoke.
- Menambah **new E2E chain suite** yang butuh row dalam state spesifik.
- Menambah **new role scenario** (mis. delegated approver).

### Prosedur

1. Edit `supabase/seed.sql` di section yang tepat (0-11 numeric).
2. Pakai deterministic UUID pattern per domain prefix.
3. Add `-- Context:` comment di atas row baru menjelaskan skenario.
4. **Wajib idempotent** — pakai `ON CONFLICT DO UPDATE` atau ensure section 0 (wipe) mencatat cleanup.
5. Update dokumen ini di section terkait.
6. `pnpm db:reset` untuk verify.
7. Kalau ada test baru pakai seed row baru, hardcode ID di test file dengan comment referencing seed section.

### Contoh

```sql
-- §6.5 CA-3: FIELD_OPS mode, Rp 25jt, ready untuk OM approval test.
--
-- Used by e2e/canonical-cash-advance.spec.ts "OM approves L3 field ops".
-- After OM approve, expected next state = PENDING_FINANCE.
INSERT INTO public.cash_advances (
  id, tenant_id, project_id, ca_type, amount, purpose,
  submitted_by_employee_id, submitted_at, status
) VALUES (
  '66666666-1111-4111-8111-333333333333',
  v_tenant_id,
  v_nusa_cs_project_id,
  'FIELD_OPS',
  25000000,
  'Site survey Sumatera',
  v_supervisor_emp_id,
  now() - interval '2 days',
  'PENDING_L3_OPERATIONS_MANAGER'
)
ON CONFLICT (id) DO UPDATE
  SET status = EXCLUDED.status,
      amount = EXCLUDED.amount;
```

## Environments checklist

| Env         | Auto-seed?              | Notes                                                                       |
| ----------- | ----------------------- | --------------------------------------------------------------------------- |
| Local dev   | Manual via `pnpm db:reset` | Full seed, no data loss (dev DB isolated per developer machine).         |
| CI E2E      | Automatic in `e2e.yml`   | Fresh Supabase per run + full seed.                                       |
| Staging     | Manual first-time; migration-only after | Seed once at bootstrap; production-shape data thereafter (real BPO trials). |
| Production  | **NEVER auto-seed**      | Only migrations. Real customer data.                                       |

## Anti-patterns

### ❌ Hardcode data yang bukan seeded

```ts
// BAD — assume proj-foo exists (tidak di seed).
await page.goto("/projects/proj-foo");
```

**Fix**: pakai seeded ID atau buat row via UI dulu di setup test.

### ❌ Rely pada order test file

```ts
// BAD — test B assumes test A ran first.
test("B: PM approves", async ({ page }) => {
  // relies on test A's mutation
});
```

**Fix**: pakai `test.describe.configure({ mode: "serial" })` +
declare dependency di docstring.

### ❌ Random data yang tidak reproducible

```ts
// BAD — flake magnet.
const amount = Math.floor(Math.random() * 10_000_000);
await page.getByLabel(/amount/i).fill(String(amount));
```

**Fix**: deterministic value:

```ts
const AMOUNT_FIELD_OPS_L3 = 25_000_000;  // triggers PM + OM chain.
await page.getByLabel(/amount/i).fill(String(AMOUNT_FIELD_OPS_L3));
```

### ❌ Mutate seed dari Vitest

Never — Vitest tidak connect ke DB. Kalau butuh, redesign sebagai
Playwright test.

## Where to look next

- Run test setelah setup data → [`e2e-playbook.md`](e2e-playbook.md).
- Test catalog → [`test-catalog.md`](test-catalog.md).
- Manual smoke → [`manual-smoke-scripts.md`](manual-smoke-scripts.md).
