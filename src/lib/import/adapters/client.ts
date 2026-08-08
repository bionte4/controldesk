import "server-only";

import { z } from "zod";

import type { ImportAdapter } from "../types";

const CLIENT_STATUSES = ["PROSPECT", "ACTIVE", "ON_HOLD", "CHURNED"] as const;

type ClientCommit = {
  name: string;
  industry: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: (typeof CLIENT_STATUSES)[number];
  contract_number: string | null;
  project_code: string | null;
  notes: string | null;
};

const rowSchema = z.object({
  name: z.string().trim().min(2, "Client name required (≥2 characters)."),
  industry: z.string().trim().optional().default(""),
  contactname: z.string().trim().optional().default(""),
  contactemail: z
    .string()
    .trim()
    .optional()
    .default("")
    .refine(
      (v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "Not a valid email address.",
    ),
  contactphone: z.string().trim().optional().default(""),
  status: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine(
      (v) => v === "" || CLIENT_STATUSES.includes(v as (typeof CLIENT_STATUSES)[number]),
      `Must be one of: ${CLIENT_STATUSES.join(", ")} (or empty for PROSPECT).`,
    )
    .optional()
    .default(""),
  contractnumber: z.string().trim().optional().default(""),
  projectcode: z.string().trim().optional().default(""),
  notes: z.string().trim().optional().default(""),
});

export const clientAdapter: ImportAdapter<ClientCommit> = {
  resource: "CLIENT",
  columns: [
    { key: "name", label: "Client Name", type: "string", required: true, example: "Acme Corp" },
    { key: "industry", label: "Industry", type: "string", required: false, example: "Retail" },
    { key: "contactname", label: "Contact Name", type: "string", required: false, example: "Jane Manager" },
    { key: "contactemail", label: "Contact Email", type: "email", required: false, example: "jane@acme.com" },
    { key: "contactphone", label: "Contact Phone", type: "phone", required: false, example: "+62 21 555 1000" },
    {
      key: "status",
      label: "Status",
      type: "enum",
      required: false,
      example: "ACTIVE",
      enumValues: CLIENT_STATUSES,
    },
    { key: "contractnumber", label: "Contract Number", type: "string", required: false, example: "CTR-2026-001" },
    { key: "projectcode", label: "Project Code", type: "string", required: false, example: "ACME-01" },
    { key: "notes", label: "Notes", type: "string", required: false, example: "" },
  ],

  // Clients have no external references beyond their own uniqueness
  // check — we still need the clientByKey map to detect natural-key
  // collisions with existing rows.
  needs: { clients: true },

  validate: async ({ rows }) => {
    const valid: { row_number: number; commit: ClientCommit; key?: string }[] = [];
    const errors: { row_number: number; field: string | null; message: string; raw?: string | null }[] = [];

    const seenNames = new Set<string>();

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

      const nameKey = row.name.toLowerCase().trim();
      if (seenNames.has(nameKey)) {
        errors.push({
          row_number: rowNumber,
          field: "name",
          message: "Duplicate client name in this file.",
          raw: row.name,
        });
        return;
      }
      seenNames.add(nameKey);

      const commit: ClientCommit = {
        name: row.name,
        industry: row.industry || null,
        contact_name: row.contactname || null,
        contact_email: row.contactemail || null,
        contact_phone: row.contactphone || null,
        status: (row.status || "PROSPECT") as (typeof CLIENT_STATUSES)[number],
        contract_number: row.contractnumber || null,
        project_code: row.projectcode || null,
        notes: row.notes || null,
      };
      valid.push({ row_number: rowNumber, commit, key: nameKey });
    });

    return { valid, errors };
  },

  commit: async ({ valid, tenantId, createdBy, supabase }) => {
    let inserted = 0;
    let updated = 0;

    for (const row of valid) {
      // Match by name (case-insensitive) — clients don't have a
      // separate unique constraint besides id.
      const { data: existing } = await supabase
        .from("clients")
        .select("id")
        .eq("tenant_id", tenantId)
        .ilike("name", row.commit.name)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("clients")
          .update(row.commit)
          .eq("id", (existing as { id: string }).id)
          .eq("tenant_id", tenantId);
        if (error) throw new Error(`Row ${row.row_number}: ${error.message}`);
        updated++;
      } else {
        const { error } = await supabase.from("clients").insert({
          ...row.commit,
          tenant_id: tenantId,
          created_by: createdBy,
          onboarded_at:
            row.commit.status === "ACTIVE" ? new Date().toISOString() : null,
        });
        if (error) throw new Error(`Row ${row.row_number}: ${error.message}`);
        inserted++;
      }
    }

    return { inserted, updated };
  },
};
