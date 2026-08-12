# Bug reporting & repro playbook

Panduan filing bug **yang bagus** — actionable, reproducible, dan
di-triage cepat.

## Filosofi

> "The purpose of a bug report is to help the developer fix it, not to
> record that you found it."

Konsekuensi:
- **Repro steps yang jelas** = 80 % fix waktu hemat.
- **Artifact** (screenshot, trace, log) = zero back-and-forth.
- **Severity yang benar** = tidak underplay P0 atau overplay P3.
- **Root-cause hypothesis** (bila ada) = kickstart investigation.

## Bug lifecycle

```
[Reported] → [Triage] → [Assigned] → [Fixing] → [In Review] → [Verified] → [Closed]
                ↓
             [Deduped] atau [Won't Fix] (jika applicable)
```

- **Reported**: filed di GitHub Issues / Linear dengan template.
- **Triage**: QA Lead assign severity + area label + owner. SLA: **< 24 jam**.
- **Assigned**: engineer ambil ownership.
- **Fixing**: PR draft.
- **In Review**: PR open, awaiting review.
- **Verified**: QA reproduce fix di staging.
- **Closed**: fix di production.

## Severity guide

| Severity          | Definisi                                                              | Contoh                                                        | SLA fix       | Blocks release |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- | ------------- | -------------- |
| **S0 — Critical** | Data loss, security bypass, cross-tenant leak, financial calc error, auth bypass, service down | Approve button jalankan action untuk CA lain / Client A lihat data Client B / uang tercatat 10× | Same-day       | YES            |
| **S1 — High**     | Business flow broken tanpa workaround, major feature degraded         | Chain stuck di Finance step / Payroll amount salah / Cron gagal 24 jam | < 24 jam       | YES            |
| **S2 — Medium**   | Feature degraded dengan workaround, non-critical UX bug              | Form validasi salah pesan / date picker tampilan salah timezone | < 1 minggu     | Case-by-case   |
| **S3 — Low**      | Cosmetic, minor UX friction                                           | Icon alignment miring 2px / tooltip terlambat 100ms          | Backlog        | NO             |

### Cara pick severity

Question tree:

1. Adakah **data user tercorrupt / lost**? → S0.
2. Adakah **security posture terlanggar** (auth, RLS, tenant isolation)? → S0.
3. Adakah **money / audit trail salah**? → S0.
4. Adakah **critical flow blocked** untuk role X? → S1.
5. Adakah **workaround yang reasonable**? Yes → S2. No → S1.
6. **Cosmetic** saja? → S3.

Kalau ragu antara dua, pick yang **lebih tinggi** — QA Lead akan
downgrade saat triage kalau tidak sesuai.

## Bug template

Copy-paste ke GitHub Issue atau Linear. Isi setiap section.

```markdown
## Summary

<Satu kalimat: apa yang salah + di mana.>
Contoh: "PM Approve button pada Cash Advance detail tetap enabled setelah CA di-Reject oleh Supervisor."

## Severity

[ ] S0 — Critical
[ ] S1 — High
[X] S2 — Medium
[ ] S3 — Low

**Reasoning**: <kenapa severity ini — refer question tree di doc>.

## Environment

- App: production / staging / lokal
- Commit SHA: <copy dari /api/version>
- Browser: Chrome 128 / Safari 17 / Firefox 130 / iPad Safari
- OS: macOS 14.5 / Windows 11 / Ubuntu 22.04
- Locale: id-ID / en-US
- Theme: light / dark
- Tenant: demo / <real tenant>
- Role: PM / OM / Finance / etc.

## Steps to reproduce

1. Login as `<role>` at `<url>`.
2. Navigate ke `<page>`.
3. Klik `<button>`.
4. Isi form dengan `<values>`.
5. Submit.
6. Observe `<X>`.

## Expected result

<Apa yang seharusnya terjadi menurut design / rulebook §Y.>

## Actual result

<Apa yang benar-benar terjadi.>

## Repro rate

- [ ] 100 % — konsisten setiap kali.
- [ ] Intermittent — <X> dari <Y> kali.
- [ ] Once — belum bisa reproduce ulang.

## Artifacts

- Screenshot: <attach>
- Video / GIF: <attach kalau perlu, mis. multi-step>
- Playwright trace: <link kalau caught di E2E>
- Browser console: <paste error stack>
- Network tab: <paste failed request>
- Server log: <paste dari Datadog / Sentry / lokal>

## Hypothesis (opsional)

<Kalau Anda punya hunch root cause, tulis di sini. "I suspect
`getCanonicalDecision` mengabaikan status REJECTED".>

## Related

- Related to #<issue>
- Docs: <link ke rulebook § / QA doc yang di-violate>
- Test: <link ke Playwright / Vitest test yang seharusnya catch ini>
```

## Reproduction workflow

Sebelum file bug, coba minimize + reproduce. Effort di sini menghemat
banyak waktu.

### Step 1: Isolate

**Try turun tingkat**:
- Dari production → staging → lokal.
- Dari real tenant → demo tenant.
- Dari end-to-end flow → single action.

Kalau bug hanya reproduce di production, note itu di environment
section.

### Step 2: Minimize input

**Coba hilangkan variable**:
- Same role? Try role berbeda.
- Same amount? Try amount berbeda.
- Same browser? Try browser lain.
- Same locale? Toggle locale.
- Same tenant? Try tenant kedua.

**Konvergen ke minimum repro**: langkah paling sedikit + input paling
sederhana yang tetap trigger bug.

### Step 3: Capture artifacts

- **Screenshot**: `Cmd + Shift + 5` (macOS) atau Windows Snipping Tool.
  Highlight the offending area dengan panah / lingkaran.
- **Video**: kalau multi-step, capture GIF dengan Kap / LICEcap /
  ScreenToGif. Max 30 detik, focus on action + result.
- **Browser console** (F12 → Console tab):
  - Screenshot semua error.
  - Paste stack trace dengan preserved formatting (dalam code block).
- **Network tab**: kalau request fail, capture Headers + Response.
- **Local storage / cookies**: kalau bug depend on session state, note
  cookie yang set (redact sensitive values seperti Bearer token).

### Step 4: Cross-check docs

- Baca rulebook § yang govern behavior — apakah ini bug atau
  feature-as-designed?
- Baca [`test-catalog.md`](test-catalog.md) — apakah ada test yang
  seharusnya cover?
- Kalau ada test yang cover tapi gagal catch → CI issue (test lemah).
- Kalau tidak ada test yang cover → gap coverage (file separate issue
  `test-gap`).

### Step 5: Formulate hypothesis (opsional)

Kalau Anda punya code access dan waktu:
- `grep` untuk function yang relevant.
- Baca implementation → identify suspicious branch / missing guard.
- Note hipotesis di bug report — engineer bisa validate cepat.

## Repro techniques

### Backend / DB verification

Kalau bug seemingly UI tapi Anda curiga data corrupt:

```bash
# Check state row langsung di DB.
docker exec -it supabase_db_controldesk psql -U postgres -d postgres

# Query.
SELECT id, status, amount, submitted_at
FROM public.cash_advances
WHERE id = '66666666-...';

# Check audit trail.
SELECT actor_id, action_type, old_values, new_values, created_at
FROM public.security_audit_logs
WHERE resource_name = 'cash_advance'
  AND resource_id = '66666666-...'
ORDER BY created_at DESC;
```

Kalau state DB sudah salah → backend bug (Server Action, state machine).
Kalau state DB benar tapi UI show salah → frontend bug (fetching, rendering).

### Timing-related bug

Reproduce dengan network throttling:
- Chrome DevTools → Network tab → Throttling → "Slow 3G".
- Ulangi flow.
- Kalau bug muncul → race condition / missing loading state.

### Multi-user race condition

Buka 2 browser (Chrome + Chrome Incognito) sebagai user berbeda:
- Window 1: as Supervisor, in approvals inbox.
- Window 2: as Employee, submit new CA.
- Watch window 1 — realtime update should show item.

Kalau timing off → possible realtime bug.

### Locale / theme drift

Toggle di UI:
- Language toggle EN ↔ ID.
- Theme toggle light ↔ dark.

Kalau bug muncul cuma di satu combination → CSS / i18n bug.

## Filing to the right place

### GitHub Issues (open source flow)

- Repo: `bontiharyanto/controldesk`.
- Label wajib: `bug` + severity (`s0` / `s1` / `s2` / `s3`).
- Label area: `security` / `finance` / `hris` / `portal` / `ci` / `a11y` / `docs`.

### Linear (internal, kalau ada workspace)

- Project: ControlDesk.
- State: `Todo`.
- Priority: sesuai severity.
- Assignee: Tech Lead untuk triage.

### Slack #bugs

Untuk **S0 CRITICAL** yang butuh instant attention:
1. Post di `#bugs` (atau `#alerts` production) dengan:
   - `@here` mention.
   - Link ke issue.
   - 1-liner impact statement.
2. Notify on-call engineer via PagerDuty / phone kalau after-hours.

## Priority + assignment

Setelah bug filed, QA Lead / Tech Lead triage:

1. **Verify severity** — downgrade / upgrade jika perlu.
2. **Add owner** — assign engineer based on area.
3. **Add sprint** — S0/S1 langsung current sprint, S2 next sprint, S3 backlog.
4. **Link related issues** — cross-ref bugs yang mungkin duplicate atau symptom sama.

## Verifying fix

Setelah PR fix di-merge:

### Step 1: automated verify

- Check CI green pada PR.
- Verify regression test added (kalau applicable):
  - Vitest test yang catch bug root cause.
  - Playwright test yang catch flow.

### Step 2: manual verify di staging

Setelah deploy ke staging:

1. Reproduce **exact same steps** dari bug report.
2. Verify bug tidak muncul lagi.
3. Verify **no regression** di flow terkait (5-menit smoke).

### Step 3: sign-off

- Comment di issue: "Verified fix on staging deploy `<sha>`. Ready for
  production release."
- QA sign-off di issue.
- Close issue setelah production deploy.

### Step 4: post-mortem (S0 only)

Untuk S0 di production yang **impacted real users**:

1. Doc `docs/incidents/YYYY-MM-DD-<slug>.md`:
   - Timeline (detected → mitigated → resolved).
   - Impact (users affected, duration).
   - Root cause.
   - Fix + validation.
   - Prevention (test added, monitoring added, process changed).
2. Share di next team retro.
3. Track action items sampai closed.

## Common bug patterns di ControlDesk

Berdasarkan history bug yang muncul di project ini:

### Pattern: cross-tenant leak

**Detection**: user di tenant A lihat data tenant B.

**Root cause biasa**:
- Query lupa filter `.eq("tenant_id", tenantId)`.
- Server Action tidak call `getTenantContext()`.
- RLS policy lupa cover role tertentu.

**Repro test**: buka dua tenant subdomain dengan admin masing-masing,
verify data isolation.

### Pattern: money math off-by-one

**Detection**: total salah 1 rupiah / 1 sen.

**Root cause biasa**:
- Float arithmetic (`0.1 + 0.2 !== 0.3`).
- Rounding di UI vs DB berbeda.

**Fix**: pakai `bigint` cents throughout.

### Pattern: approval chain stuck

**Detection**: item di state PENDING_X selama > 24 jam tanpa notifikasi.

**Root cause biasa**:
- Approver role tidak assigned di tenant tersebut.
- Notification enqueue gagal.
- State transition lupa emit notification.

**Repro**: file item, immediately check `notifications` table for
enqueue row.

### Pattern: proxy silently disabled

**Detection**: `TENANT_UNKNOWN` error di Server Action, atau data
tidak muncul karena tenant scope wrong.

**Root cause biasa** (project spesifik):
- `proxy.ts` di root, bukan `src/proxy.ts` (Next.js 16).
- Headers tidak diproagate dengan `NextResponse.next({ request: { headers } })`.

**Fix**: verify `ls src/proxy.ts` ada.

### Pattern: seed drift chain suite fail

**Detection**: chain suite E2E fail dari step 2, step 1 sukses.

**Root cause**: seed row sudah di-mutate previous run.

**Fix**: `pnpm db:reset` sebelum re-run.

### Pattern: locale sticky

**Detection**: user ganti locale, tapi text tetap di locale sebelumnya.

**Root cause biasa**:
- Cookie `NEXT_LOCALE` tidak di-set dengan `path=/`.
- Server Component fetch translations dengan cache stale.

**Fix**: hard refresh + verify cookie value.

## Anti-patterns

### ❌ Vague summary

```
"Approval button not working"
```

**Fix**: specific:

```
"PM Approve button remains enabled after CA rejected by Supervisor
(cash-advances/[id] page, both locale)"
```

### ❌ No repro steps

```
"Something's wrong with the dashboard"
```

**Fix**: numbered steps + expected + actual.

### ❌ Screenshot without context

Screenshot yang tidak show URL bar / role / relevant surrounding.

**Fix**: full window screenshot atau annotate area of interest.

### ❌ Combining multiple bugs

```
"Approval doesn't work AND profile page slow AND notifications missing"
```

**Fix**: file 3 separate issues, cross-link kalau related.

### ❌ Fix suggestions instead of bug report

```
"Please add a check for status === REJECTED in the approve handler."
```

**Fix**: report **what** is wrong, biarkan engineer decide **how** to
fix. OK kalau tambah hipotesis di section terpisah.

### ❌ Repro yang tidak reproducible

```
"Sometimes clicking approve doesn't do anything."
```

**Fix**: investigate lebih dulu — coba 10× dan catat pattern. Note
repro rate.

## Templates ready-to-use

Simpan di clipboard manager (Alfred / Raycast):

### S0 template

```markdown
🚨 **S0 CRITICAL**: <summary>

**Impact**: <who + how many + what data>
**Environment**: production / staging
**Detected**: <timestamp>
**Reporter**: <name>

## Repro
1. ...
2. ...
3. ...

## Expected
...

## Actual
...

## Artifacts
- Screenshot: ...
- Server log: ...
- Trace: ...

## Immediate mitigation
- [ ] Rollback deploy? YES / NO
- [ ] Feature flag off? YES / NO
- [ ] Notify affected tenants? YES / NO
```

### S1-S3 template

Sama dengan main [Bug template](#bug-template).

### A11y bug template

```markdown
## A11y Bug: <summary>

- **WCAG SC violated**: <e.g. 1.4.3 Contrast (Minimum)>
- **Severity**: S1 (blocks WCAG 2.2 AAA conformance)
- **Page**: `/dashboard`
- **Element**: `.text-muted-foreground` on light mode

## Repro
1. Buka `/dashboard` di light mode.
2. Inspect element muted text.
3. axe DevTools → Scan → observe violation.

## Expected
Contrast ratio ≥ 7:1 (AAA) per rules §23.

## Actual
Contrast ratio 3.2:1.

## Suggested fix
Replace `text-muted-foreground` dengan `text-slate-700 dark:text-slate-300`.
```

### Flake template

Lihat [`flake-triage.md#step-1-log-the-flake`](flake-triage.md#step-1-log-the-flake).

## Where to look next

- Overview strategi → [`testing-strategy.md`](testing-strategy.md).
- Manual smoke → [`manual-smoke-scripts.md`](manual-smoke-scripts.md).
- Flake handling → [`flake-triage.md`](flake-triage.md).
- Docs index → [`README.md`](README.md).
