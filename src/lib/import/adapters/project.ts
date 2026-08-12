import "server-only";

import { z } from "zod";

import { resolveClient } from "../resolver";
import type { ImportAdapter } from "../types";

const PROJECT_STATUSES = [
  "DRAFT",
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
] as const;

const PROJECT_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

const PROJECT_TYPES = [
  "FIXED_PRICE",
  "TIME_MATERIAL",
  "RETAINER",
  "INTERNAL",
] as const;

type ProjectCommit = {
  client_id: string;
  code: string;
  name: string;
  description: string | null;
  status: (typeof PROJECT_STATUSES)[number];
  project_type: (typeof PROJECT_TYPES)[number];
  priority: (typeof PROJECT_PRIORITIES)[number];
  start_date: string | null;
  end_date: string | null;
  contract_value: number | null;
  location: string | null;
  notes: string | null;
};

const rowSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[A-Za-z0-9_-]+$/, "Use letters, digits, underscore or hyphen only."),
    name: z.string().trim().min(2).max(120),
    clientname: z
      .string()
      .trim()
      .min(2, "Client identifier required (name, contract#, or project code)."),
    description: z.string().trim().optional().default(""),
    status: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .refine(
        (v) =>
          v === "" ||
          PROJECT_STATUSES.includes(v as (typeof PROJECT_STATUSES)[number]),
        `Must be one of: ${PROJECT_STATUSES.join(", ")} (or empty for PLANNING).`,
      )
      .optional()
      .default(""),
    projecttype: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .refine(
        (v) =>
          v === "" ||
          PROJECT_TYPES.includes(v as (typeof PROJECT_TYPES)[number]),
        `Must be one of: ${PROJECT_TYPES.join(", ")} (or empty for INTERNAL).`,
      )
      .optional()
      .default(""),
    priority: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .refine(
        (v) =>
          v === "" ||
          PROJECT_PRIORITIES.includes(v as (typeof PROJECT_PRIORITIES)[number]),
        `Must be one of: ${PROJECT_PRIORITIES.join(", ")} (or empty for MEDIUM).`,
      )
      .optional()
      .default(""),
    startdate: z
      .string()
      .trim()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/u, "Use ISO date or leave blank.")
      .optional()
      .default(""),
    enddate: z
      .string()
      .trim()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/u, "Use ISO date or leave blank.")
      .optional()
      .default(""),
    contractvalue: z
      .string()
      .trim()
      .optional()
      .default("")
      .refine(
        (v) => v === "" || /^\d+(\.\d{1,2})?$/.test(v),
        "Numeric IDR amount (e.g. 12500000 or 12500000.00). No commas / currency symbol.",
      ),
    location: z.string().trim().optional().default(""),
    notes: z.string().trim().optional().default(""),
  })
  .refine(
    (d) => !d.startdate || !d.enddate || d.startdate <= d.enddate,
    { message: "Start Date must be on or before End Date.", path: ["enddate"] },
  );

export const projectAdapter: ImportAdapter<ProjectCommit> = {
  resource: "PROJECT",
  columns: [
    { key: "code", label: "Project Code", type: "string", required: true, example: "ACME-01" },
    { key: "name", label: "Project Name", type: "string", required: true, example: "Acme onboarding" },
    {
      key: "clientname",
      label: "Client (name or contract#)",
      type: "ref",
      required: true,
      example: "Acme Corp",
      refHint: "Matches by client name, contract number, or project code (registered in Clients)",
    },
    { key: "description", label: "Description", type: "string", required: false, example: "Roll out ERP for Acme" },
    {
      key: "status",
      label: "Status",
      type: "enum",
      required: false,
      example: "PLANNING",
      enumValues: PROJECT_STATUSES,
    },
    {
      key: "projecttype",
      label: "Project Type",
      type: "enum",
      required: false,
      example: "FIXED_PRICE",
      enumValues: PROJECT_TYPES,
    },
    {
      key: "priority",
      label: "Priority",
      type: "enum",
      required: false,
      example: "MEDIUM",
      enumValues: PROJECT_PRIORITIES,
    },
    { key: "startdate", label: "Start Date", type: "date", required: false, example: "2026-02-01" },
    { key: "enddate", label: "End Date", type: "date", required: false, example: "2026-11-30" },
    { key: "contractvalue", label: "Contract Value (IDR)", type: "money", required: false, example: "500000000" },
    { key: "location", label: "Location", type: "string", required: false, example: "Jakarta" },
    { key: "notes", label: "Notes", type: "string", required: false, example: "" },
  ],

  needs: { clients: true, projects: true },

  validate: async ({ rows, maps }) => {
    const valid: { row_number: number; commit: ProjectCommit; key?: string }[] = [];
    const errors: { row_number: number; field: string | null; message: string; raw?: string | null }[] = [];

    const seenCodes = new Set<string>();

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

      const codeKey = row.code.toUpperCase();
      if (seenCodes.has(codeKey)) {
        errors.push({
          row_number: rowNumber,
          field: "code",
          message: "Duplicate project code in this file.",
          raw: row.code,
        });
        return;
      }
      seenCodes.add(codeKey);

      const clientId = resolveClient(maps, row.clientname);
      if (!clientId) {
        errors.push({
          row_number: rowNumber,
          field: "clientname",
          message: `Unknown client "${row.clientname}". Register the client first (or bulk import Clients).`,
          raw: row.clientname,
        });
        return;
      }

      const commit: ProjectCommit = {
        client_id: clientId,
        code: codeKey,
        name: row.name,
        description: row.description || null,
        status: (row.status || "PLANNING") as (typeof PROJECT_STATUSES)[number],
        project_type: (row.projecttype ||
          "INTERNAL") as (typeof PROJECT_TYPES)[number],
        priority: (row.priority || "MEDIUM") as (typeof PROJECT_PRIORITIES)[number],
        start_date: row.startdate || null,
        end_date: row.enddate || null,
        contract_value: row.contractvalue ? Number(row.contractvalue) : null,
        location: row.location || null,
        notes: row.notes || null,
      };
      valid.push({ row_number: rowNumber, commit, key: codeKey });
    });

    return { valid, errors };
  },

  commit: async ({ valid, tenantId, createdBy, supabase }) => {
    let inserted = 0;
    let updated = 0;

    for (const row of valid) {
      const { data: existing } = await supabase
        .from("projects")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("code", row.commit.code)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("projects")
          .update(row.commit)
          .eq("id", (existing as { id: string }).id)
          .eq("tenant_id", tenantId);
        if (error) throw new Error(`Row ${row.row_number}: ${error.message}`);
        updated++;
      } else {
        const { error } = await supabase.from("projects").insert({
          ...row.commit,
          tenant_id: tenantId,
          created_by: createdBy,
        });
        if (error) throw new Error(`Row ${row.row_number}: ${error.message}`);
        inserted++;
      }
    }

    return { inserted, updated };
  },
};
