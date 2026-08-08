import "server-only";

import { z } from "zod";

import { resolveCoa, resolveProject } from "../resolver";
import type { ImportAdapter } from "../types";

/**
 * Budget line items import — GRID mode. One CSV / XLSX = many lines,
 * each row targeting a specific (project, fiscal_year, coa) tuple.
 *
 * The committer groups rows by (project, fiscal_year) and:
 *   1. Ensures a `budgets` row exists (creates DRAFT if missing).
 *   2. Inserts / updates `budget_details` rows for each line.
 *   3. Rolls `budgets.total_planned_amount = sum(planned)` at the end.
 *
 * Note: does NOT touch approval status — imported budgets stay DRAFT
 * until Finance approves via the normal UI flow.
 */

type BudgetLineCommit = {
  project_id: string;
  project_code: string;
  fiscal_year: number;
  budget_title: string;
  coa_id: string;
  coa_code: string;
  seq: number;
  category: string;
  description: string | null;
  planned_amount: number;
};

const rowSchema = z.object({
  projectcode: z.string().trim().min(2),
  fiscalyear: z
    .string()
    .trim()
    .regex(/^\d{4}$/u, "Four-digit fiscal year (e.g. 2026)."),
  budgettitle: z.string().trim().optional().default(""),
  coacode: z.string().trim().min(1),
  category: z.string().trim().min(1),
  description: z.string().trim().optional().default(""),
  plannedamount: z
    .string()
    .trim()
    .regex(
      /^\d+(\.\d{1,2})?$/u,
      "Numeric IDR amount (e.g. 50000000 or 50000000.00). No commas / currency.",
    ),
  seq: z
    .string()
    .trim()
    .regex(/^\d*$/u, "Integer sequence or blank.")
    .optional()
    .default(""),
});

export const budgetLineAdapter: ImportAdapter<BudgetLineCommit> = {
  resource: "BUDGET_LINE",
  grid: true,
  columns: [
    {
      key: "projectcode",
      label: "Project Code",
      type: "ref",
      required: true,
      example: "ACME-01",
      refHint: "Must exist in Projects (register first, or bulk import Projects)",
    },
    {
      key: "fiscalyear",
      label: "Fiscal Year",
      type: "number",
      required: true,
      example: "2026",
    },
    {
      key: "budgettitle",
      label: "Budget Title",
      type: "string",
      required: false,
      example: "FY 2026 operations",
    },
    {
      key: "coacode",
      label: "COA Code",
      type: "ref",
      required: true,
      example: "5100-01",
      refHint: "Must exist in Settings → Chart of Accounts",
    },
    { key: "category", label: "Category", type: "string", required: true, example: "Salary" },
    {
      key: "description",
      label: "Description",
      type: "string",
      required: false,
      example: "Team lead 2 people",
    },
    {
      key: "plannedamount",
      label: "Planned Amount (IDR)",
      type: "money",
      required: true,
      example: "50000000",
    },
    { key: "seq", label: "Sequence", type: "number", required: false, example: "1" },
  ],

  needs: { projects: true, coa: true, budgets: true },

  validate: async ({ rows, maps }) => {
    const valid: { row_number: number; commit: BudgetLineCommit; key?: string }[] = [];
    const errors: { row_number: number; field: string | null; message: string; raw?: string | null }[] = [];

    // Per (project_code, fiscal_year, coa_code) dedup — no duplicate
    // lines in the same file. Users often accidentally duplicate.
    const seenLines = new Set<string>();

    rows.forEach((raw, idx) => {
      const rowNumber = idx + 1;
      const parsed = rowSchema.safeParse(raw);
      if (!parsed.success) {
        for (const iss of parsed.error.issues) {
          errors.push({
            row_number: rowNumber,
            field: iss.path.join("."),
            message: iss.message,
            raw: (raw[iss.path.join(".")] as string) ?? null,
          });
        }
        return;
      }
      const row = parsed.data;

      const projectId = resolveProject(maps, row.projectcode);
      if (!projectId) {
        errors.push({
          row_number: rowNumber,
          field: "projectcode",
          message: `Unknown project code "${row.projectcode}". Bulk import Projects first, or add manually.`,
          raw: row.projectcode,
        });
        return;
      }
      const coaId = resolveCoa(maps, row.coacode);
      if (!coaId) {
        errors.push({
          row_number: rowNumber,
          field: "coacode",
          message: `Unknown COA code "${row.coacode}". Register in Settings → Chart of Accounts first.`,
          raw: row.coacode,
        });
        return;
      }

      const dedupeKey = `${row.projectcode.toUpperCase()}:${row.fiscalyear}:${row.coacode.toUpperCase()}`;
      if (seenLines.has(dedupeKey)) {
        errors.push({
          row_number: rowNumber,
          field: "coacode",
          message: "Duplicate (project, year, COA) line in this file.",
          raw: row.coacode,
        });
        return;
      }
      seenLines.add(dedupeKey);

      const commit: BudgetLineCommit = {
        project_id: projectId,
        project_code: row.projectcode.toUpperCase(),
        fiscal_year: Number(row.fiscalyear),
        budget_title:
          row.budgettitle || `FY ${row.fiscalyear} — ${row.projectcode.toUpperCase()}`,
        coa_id: coaId,
        coa_code: row.coacode.toUpperCase(),
        seq: row.seq ? Number(row.seq) : idx + 1,
        category: row.category,
        description: row.description || null,
        planned_amount: Number(row.plannedamount),
      };
      valid.push({ row_number: rowNumber, commit, key: dedupeKey });
    });

    return { valid, errors };
  },

  commit: async ({ valid, tenantId, createdBy, supabase }) => {
    let inserted = 0;
    let updated = 0;

    // Group lines by (project_id, fiscal_year) so we can create a
    // shared `budgets` row per group.
    type GroupKey = string;
    const groups = new Map<
      GroupKey,
      { project_id: string; fiscal_year: number; title: string; lines: typeof valid }
    >();
    for (const v of valid) {
      const k = `${v.commit.project_id}:${v.commit.fiscal_year}`;
      const existing = groups.get(k);
      if (existing) {
        existing.lines.push(v);
      } else {
        groups.set(k, {
          project_id: v.commit.project_id,
          fiscal_year: v.commit.fiscal_year,
          title: v.commit.budget_title,
          lines: [v],
        });
      }
    }

    for (const g of groups.values()) {
      // 1. Get or create the umbrella `budgets` row.
      let budgetId: string;
      const { data: existingBudget } = await supabase
        .from("budgets")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("project_id", g.project_id)
        .eq("fiscal_year", g.fiscal_year)
        .eq("status", "DRAFT")
        .maybeSingle();
      if (existingBudget) {
        budgetId = (existingBudget as { id: string }).id;
      } else {
        // Only create a new DRAFT if there's no APPROVED for the same
        // (project, year) — APPROVED means Finance already sealed it,
        // and bulk-import must not fork a shadow DRAFT.
        const { data: approved } = await supabase
          .from("budgets")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("project_id", g.project_id)
          .eq("fiscal_year", g.fiscal_year)
          .eq("status", "APPROVED")
          .maybeSingle();
        if (approved) {
          throw new Error(
            `Project ${g.lines[0].commit.project_code} FY ${g.fiscal_year} already has an APPROVED budget. Bulk import cannot mutate approved budgets. Create a Budget Request via the UI instead.`,
          );
        }
        const { data: created, error } = await supabase
          .from("budgets")
          .insert({
            tenant_id: tenantId,
            project_id: g.project_id,
            fiscal_year: g.fiscal_year,
            title: g.title,
            status: "DRAFT",
            currency: "IDR",
            created_by: createdBy,
            updated_by: createdBy,
          })
          .select("id")
          .single();
        if (error || !created) {
          throw new Error(`Budget umbrella for ${g.lines[0].commit.project_code} FY ${g.fiscal_year}: ${error?.message ?? "unknown"}`);
        }
        budgetId = (created as { id: string }).id;
      }

      // 2. Insert / update lines. Match by (budget_id, coa_id).
      for (const line of g.lines) {
        const { data: existingLine } = await supabase
          .from("budget_details")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("budget_id", budgetId)
          .eq("coa_id", line.commit.coa_id)
          .maybeSingle();

        if (existingLine) {
          const { error } = await supabase
            .from("budget_details")
            .update({
              seq: line.commit.seq,
              category: line.commit.category,
              description: line.commit.description,
              planned_amount: line.commit.planned_amount,
              code: line.commit.coa_code,
              updated_by: createdBy,
            })
            .eq("id", (existingLine as { id: string }).id)
            .eq("tenant_id", tenantId);
          if (error)
            throw new Error(`Row ${line.row_number}: ${error.message}`);
          updated++;
        } else {
          const { error } = await supabase.from("budget_details").insert({
            tenant_id: tenantId,
            budget_id: budgetId,
            coa_id: line.commit.coa_id,
            code: line.commit.coa_code,
            seq: line.commit.seq,
            category: line.commit.category,
            description: line.commit.description,
            planned_amount: line.commit.planned_amount,
            created_by: createdBy,
            updated_by: createdBy,
          });
          if (error)
            throw new Error(`Row ${line.row_number}: ${error.message}`);
          inserted++;
        }
      }

      // 3. Roll up `budgets.total_planned_amount = sum(planned)`.
      const { data: allLines } = await supabase
        .from("budget_details")
        .select("planned_amount")
        .eq("tenant_id", tenantId)
        .eq("budget_id", budgetId);
      const total = ((allLines ?? []) as { planned_amount: number | string }[]).reduce(
        (acc, r) => acc + Number(r.planned_amount ?? 0),
        0,
      );
      await supabase
        .from("budgets")
        .update({ total_planned_amount: total, updated_by: createdBy })
        .eq("id", budgetId)
        .eq("tenant_id", tenantId);
    }

    return { inserted, updated };
  },
};
