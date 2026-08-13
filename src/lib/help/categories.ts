/**
 * Client-safe help-article types and category metadata.
 *
 * Split out from `articles.ts` because that file imports
 * `"server-only"` (it reads markdown from the filesystem via
 * `node:fs`), while a couple of client components (
 * `help-search.tsx`, and any future card renderer) need the
 * category taxonomy for rendering labels. Keeping this module free of
 * server-only imports is what lets the Next.js production build
 * cross the client-boundary safely; without the split, the webpack
 * pass complains with:
 *
 *   Error: 'server-only' cannot be imported from a Client Component module
 *
 * Everything here is pure data — no side effects, no fs, no db.
 */

export type HelpCategoryId =
  | "getting-started"
  | "user-guides"
  | "approvals"
  | "finance"
  | "hr"
  | "integrations"
  | "reference";

export const HELP_CATEGORY_ORDER: readonly HelpCategoryId[] = [
  "getting-started",
  "user-guides",
  "approvals",
  "finance",
  "hr",
  "integrations",
  "reference",
] as const;

export const HELP_CATEGORY_META: Record<
  HelpCategoryId,
  { titleId: string; titleEn: string }
> = {
  "getting-started": {
    titleId: "Memulai",
    titleEn: "Getting started",
  },
  "user-guides": {
    titleId: "Panduan pengguna",
    titleEn: "User guides",
  },
  approvals: {
    titleId: "Alur persetujuan",
    titleEn: "Approval workflows",
  },
  finance: {
    titleId: "Keuangan",
    titleEn: "Finance",
  },
  hr: {
    titleId: "HR & Timesheet",
    titleEn: "HR & Timesheet",
  },
  integrations: {
    titleId: "Integrasi",
    titleEn: "Integrations",
  },
  reference: {
    titleId: "Referensi",
    titleEn: "Reference",
  },
};
