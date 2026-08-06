# Accessibility testing

ControlDesk memiliki **WCAG 2.2 AAA sebagai target enforced** (rules §23).
Doc ini panduan lengkap **cara verify** — automated tools + manual
audits + browser techniques.

## Kenapa AAA (bukan AA)

- ControlDesk dipakai oleh BPO industry — banyak agent shift kerja
  malam / mata lelah / mobilitas terbatas. Kontras + focus yang
  generous membantu.
- Klien enterprise (BUMN, financial) mensyaratkan A11y sertifikasi
  procurement.
- Cost tambahan AAA vs AA sedikit kalau design system disiplin dari awal.

## Standar mandatory (dari rules §23)

| Aspek                    | Standar                                                                | Verifikasi                                                   |
| ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Text contrast            | ≥ 7:1 (AAA)                                                            | Chrome DevTools / axe / manual di light + dark               |
| Large text contrast      | ≥ 4.5:1 (18pt+ atau 14pt bold)                                         | Same                                                         |
| Non-text contrast (UI)   | ≥ 3:1 (AA — sudah cukup)                                              | Chrome DevTools / axe                                        |
| Keyboard reachability    | 100 % — semua action reachable tanpa mouse                             | Manual Tab + Enter + Space + Esc                             |
| Focus indicator          | Konsisten, visible (`focus-visible:ring-2 focus-visible:ring-indigo-500`) | Manual Tab through page                                    |
| ARIA labels              | Semua icon-only button + dialog + region punya `aria-label` / `aria-labelledby` | axe automation + manual screen reader                |
| Reduced motion           | Respect `prefers-reduced-motion` — Framer Motion di-guard              | Manual toggle di OS + verify no animation                    |
| Screen reader compat     | Toast + realtime update announced dengan `aria-live`                   | Manual pakai VoiceOver / NVDA                                |
| Form error binding       | `aria-describedby` link error message ke input                         | Manual + axe                                                 |
| Language attribute       | `<html lang="id">` atau `<html lang="en">` sesuai locale                | View source / axe                                            |

## Tooling

### Automated (baseline check)

1. **axe DevTools browser extension** — Chrome + Firefox.
   - Install: [axe DevTools](https://chrome.google.com/webstore/detail/axe-devtools-web-accessib/lhdoppojpmngadmnindnejefpokejbdd).
   - Run per page: DevTools → axe DevTools → Scan All of My Page.
   - Verify: 0 issue di severity `serious` + `critical`.

2. **Chrome Lighthouse** — built-in.
   - DevTools → Lighthouse → Accessibility category → Analyze.
   - Target score: **≥ 95** (100 ideal).

3. **`@axe-core/playwright`** — automated di E2E (planned).
   ```ts
   // e2e/a11y.spec.ts (planned)
   import AxeBuilder from "@axe-core/playwright";
   test("dashboard has no a11y issues", async ({ page }) => {
     await loginAs(page, "pm");
     await page.goto("/dashboard");
     const results = await new AxeBuilder({ page }).analyze();
     expect(results.violations).toEqual([]);
   });
   ```

### Manual — screen reader

**macOS**: **VoiceOver**
- Enable: `Cmd + F5`.
- Navigate: `Ctrl + Option + ArrowKeys`.
- Announce next item: `Ctrl + Option + Space`.

**Windows**: **NVDA** (free) atau JAWS (commercial).
- NVDA: [nvaccess.org](https://www.nvaccess.org/).
- Navigate: `H` (heading), `F` (form field), `B` (button), `Tab` (interactive).

**Linux**: **Orca** — built-in Ubuntu.

### Manual — keyboard-only

Cara paling cepat catch keyboard trap:

1. Buka page target.
2. Klik URL bar (untuk focus browser chrome).
3. `Tab` melalui setiap element.
4. Verify:
   - Setiap interactive punya focus indicator visible.
   - Order Tab logis (top-to-bottom, left-to-right).
   - `Enter` / `Space` activate button.
   - `Esc` close dialog / dropdown.
   - No trap — bisa Tab keluar dari setiap widget.

### Chrome DevTools contrast checker

1. Inspect element yang mau di-check.
2. Klik color swatch di Styles panel.
3. Verify "Contrast ratio" ≥ 7 : 1 (AAA) untuk text.
4. Kalau kurang, tunjukkan minimum bar untuk AA + AAA.

## Manual audit checklist per page

Setiap page baru / redesign wajib melalui checklist ini sebelum merge.

### Struktur semantik

- [ ] `<h1>` unique per page (title utama).
- [ ] Heading hierarchy tidak skip level (h1 → h2 → h3, bukan h1 → h3).
- [ ] Landmark region: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`.
- [ ] Setiap form punya `<fieldset>` + `<legend>` untuk group related.
- [ ] Table punya `<caption>` atau `aria-label`.
- [ ] List pakai `<ul>` / `<ol>` — bukan sekumpulan `<div>`.

### Keyboard

- [ ] Semua button reachable dengan `Tab`.
- [ ] Focus indicator visible di setiap step (ring-2 indigo, bukan browser default).
- [ ] Modal / Sheet / Dialog trap focus **dengan benar** — Tab loop di dalam modal, Esc close.
- [ ] Command Palette (`Ctrl+K` / `Cmd+K`) berfungsi.
- [ ] Dropdown menu (user, notifications) bisa navigate dengan Arrow keys.
- [ ] Data table row bisa Tab through actions.

### ARIA

- [ ] Icon-only button (edit, delete, close) punya `aria-label` yang descriptive.
- [ ] Dialog punya `aria-labelledby` mengarah ke title.
- [ ] Live region (`role="status"` atau `aria-live="polite"`) untuk toast + realtime update.
- [ ] Loading spinner punya `aria-label="Loading"` atau `role="status"`.
- [ ] Form field error message linked via `aria-describedby`.
- [ ] Required field marked dengan `aria-required="true"`.

### Contrast

- [ ] Body text ≥ 7 : 1 (Slate/Zinc pada background).
- [ ] Muted text ≥ 4.5 : 1 minimum.
- [ ] Button text pada primary bg ≥ 7 : 1.
- [ ] Error text (Rose) ≥ 7 : 1 pada background.
- [ ] Success text (Emerald) ≥ 7 : 1.
- [ ] Warning text (Amber) ≥ 7 : 1.
- [ ] **Both light AND dark mode** verified.

### Motion

- [ ] Toggle OS "Reduce motion" (System Settings > Accessibility > Display).
- [ ] Verify page transitions instant (no fade / slide).
- [ ] Verify Framer Motion animations skipped.
- [ ] Verify Command Palette open still works (no animation fine).

### Zoom + reflow

- [ ] Zoom browser ke 200 % — content masih legible + no horizontal scroll.
- [ ] Zoom ke 400 % — critical content reflow (WCAG 2.2 SC 1.4.10).
- [ ] Text resize kalau user override font-size — layout tidak break.

### Screen reader smoke

Test dengan VoiceOver / NVDA di halaman utama:

- [ ] Page title announced saat load.
- [ ] Landmark navigation (`Ctrl + Option + U` VoiceOver) tunjukkan header / nav / main / footer.
- [ ] Heading list (`Ctrl + Option + U` → Headings tab) menunjukkan struktur logis.
- [ ] Setiap form field dibaca sesuai label.
- [ ] Error validation dibaca saat submit.
- [ ] Toast success/error dibaca (aria-live).
- [ ] Realtime badge update (approvals inbox) diumumkan.

### i18n

- [ ] `<html lang="id">` set kalau UI Indonesian.
- [ ] Toggle EN ↔ ID via `LanguageToggle` — `lang` attribute updated.
- [ ] Screen reader baca konten dalam pronunciation yang benar.

## Per-page audit records

Track hasil audit di dokumen ini atau file terpisah per release.

| Page                             | Last audited | Score (Lighthouse) | axe violations | Owner       | Status |
| -------------------------------- | ------------ | ------------------ | -------------- | ----------- | ------ |
| `/login`                         | 2026-08-01   | 98                 | 0              | QA          | ✅     |
| `/dashboard`                     | 2026-08-01   | 96                 | 0              | QA          | ✅     |
| `/finance/cash-advances/[id]`    | 2026-08-01   | 94                 | 1 (color-contrast on muted amount) | QA + design | 🟡 |
| `/hr/requests/[id]`              | (pending)    | -                  | -              | QA          | ⏳     |
| `/portal`                        | 2026-08-05   | 97                 | 0              | QA          | ✅     |
| `/portal/projects/[id]`          | 2026-08-05   | 95                 | 0              | QA          | ✅     |

Update table setelah setiap audit cycle.

## Automation via `@axe-core/playwright` (planned)

Untuk menaikkan a11y automation, integrate `@axe-core/playwright`:

```bash
pnpm add -D @axe-core/playwright
```

Spec baseline:

```ts
// e2e/a11y-baseline.spec.ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { loginAs } from "./fixtures";

const PAGES = [
  { name: "login", path: "/login", role: null },
  { name: "dashboard", path: "/dashboard", role: "pm" as const },
  { name: "approvals inbox", path: "/approvals", role: "finance" as const },
  { name: "portal login", path: "/portal/login", role: null },
];

for (const { name, path, role } of PAGES) {
  test(`${name} has no a11y violations`, async ({ page }) => {
    if (role) await loginAs(page, role);
    await page.goto(path);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(results.violations, JSON.stringify(results.violations, null, 2))
      .toEqual([]);
  });
}
```

**Note**: axe menggunakan tags `wcag22aa`. Untuk AAA rules manual —
banyak AAA criteria tidak automat-able (mis. animation timing,
context help).

## Common issues + fixes

### Issue: icon-only button missing accessible name

**Symptom**: axe error "button-name" — VoiceOver reads "button, button".

**Fix**:

```tsx
// ❌ BAD
<Button size="icon" onClick={handleDelete}>
  <Trash2 />
</Button>

// ✓ GOOD
<Button size="icon" onClick={handleDelete} aria-label={t("common.delete")}>
  <Trash2 />
</Button>
```

Kalau butuh tooltip juga:

```tsx
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <Button size="icon" onClick={handleDelete} aria-label={t("common.delete")}>
        <Trash2 />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{t("common.delete")}</TooltipContent>
  </Tooltip>
</TooltipProvider>
```

### Issue: muted text too light

**Symptom**: `text-muted-foreground` render < 4.5 : 1 on background.

**Fix**: use `text-slate-600 dark:text-slate-400` — verified ≥ 4.5 : 1
di kedua mode.

Kalau butuh AAA (7 : 1), pakai `text-slate-700 dark:text-slate-300`.

### Issue: focus indicator hilang (menghilangkan default browser tanpa custom)

**Symptom**: Tab through — no ring visible.

**Fix**: tambah utility class:

```tsx
<button className="... focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none">
```

Semua Shadcn Button component sudah include ini default — kalau
customize, jangan strip.

### Issue: modal tidak trap focus

**Symptom**: Tab dari inside modal → focus keluar ke content di belakang.

**Fix**: pakai Radix Dialog / Shadcn Dialog — sudah handle focus trap
otomatis. Kalau custom modal, use `@radix-ui/react-focus-scope`.

### Issue: reduced-motion tidak dihormati

**Symptom**: User sudah enable "Reduce motion" di OS, tapi animation
masih jalan.

**Fix**: guard semua Framer Motion:

```tsx
"use client";
import { useReducedMotion } from "framer-motion";

export function Card() {
  const prefersReducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0 }}
      animate={prefersReducedMotion ? false : { opacity: 1 }}
      transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.3 }}
    >
      ...
    </motion.div>
  );
}
```

### Issue: form error tidak dibaca screen reader

**Symptom**: submit form dengan error, screen reader silent.

**Fix**:

```tsx
<Input
  id="email"
  type="email"
  aria-invalid={!!errors.email}
  aria-describedby={errors.email ? "email-error" : undefined}
/>
{errors.email && (
  <p id="email-error" role="alert" className="text-rose-600 text-sm">
    {errors.email.message}
  </p>
)}
```

`role="alert"` mengumumkan otomatis saat mount.

### Issue: toast tidak diumumkan

**Symptom**: Sonner toast muncul tapi VoiceOver diam.

**Fix**: pastikan Sonner init dengan aria-live-region:

```tsx
// src/components/providers.tsx
import { Toaster } from "sonner";

<Toaster position="bottom-right" closeButton richColors />
```

Sonner sudah include `role="status"` / `role="alert"` by default per
toast type.

### Issue: heading order skip

**Symptom**: axe error "heading-order" — h1 → h3 tanpa h2.

**Fix**: rewrite heading atau adjust visual size:

```tsx
// ❌ BAD
<h1>Dashboard</h1>
<h3>Recent activity</h3>

// ✓ GOOD
<h1>Dashboard</h1>
<h2>Recent activity</h2>
<h3>Approvals</h3>
```

Kalau butuh visual "small heading", gunakan class Tailwind bukan
downgrade tag:

```tsx
<h2 className="text-sm font-medium">Section title</h2>
```

## Release-level audit workflow

Setiap release (bi-weekly / monthly):

1. **Pick 5 pages** teratas by traffic (Login, Dashboard, Approvals,
   Project detail, Portal).
2. **Run axe DevTools** per page → 0 violation di severity ≥ Serious.
3. **Run Lighthouse a11y** per page → score ≥ 95.
4. **Manual keyboard** navigation Tab through end-to-end.
5. **Screen reader smoke** 3 halaman utama.
6. **Contrast check** di light + dark mode.
7. **Update audit records** di [Per-page audit records](#per-page-audit-records) table.
8. **File issues** untuk violation dengan label `a11y`.

## AAA-specific gotchas

WCAG 2.2 AAA lebih strict dari AA di:

- **Contrast**: 7 : 1 (AAA) vs 4.5 : 1 (AA) untuk text.
- **Text spacing** (SC 1.4.12): user harus bisa override line-height /
  letter-spacing tanpa hilang content.
- **Timing** (SC 2.2.3): no timeout kecuali essential (session logout OK,
  reading timeout NOT OK).
- **Motion trigger** (SC 2.3.3): user bisa disable non-essential motion.
- **Interruptions** (SC 2.2.4): user bisa disable non-emergency notifications.
- **Context help** (SC 3.3.5): help available consistent di setiap form.

ControlDesk currently meets most AAA criteria — untuk `2.3.3` (motion
disable) sudah via `useReducedMotion`. Untuk `2.2.4` (interruption)
kita punya notification preferences panel.

## Compliance documentation

Untuk audit klien enterprise:

- Screenshot audit records + Lighthouse score → PDF report per release.
- VPAT (Voluntary Product Accessibility Template) — draft di
  `docs/compliance/vpat.md` (planned).
- WCAG 2.2 AAA conformance statement — draft di
  `docs/compliance/wcag-statement.md` (planned).

## Where to look next

- Bug filing untuk a11y issue → [`bug-reporting.md`](bug-reporting.md).
- Test catalog → [`test-catalog.md`](test-catalog.md).
- E2E integration axe automation → [`e2e-playbook.md`](e2e-playbook.md).
