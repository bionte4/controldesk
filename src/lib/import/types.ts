import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawRow } from "./parsers";
import type { ResolverMaps } from "./resolver";

/**
 * Supported bulk-import resources. Must stay in sync with the
 * `import_job_resource` enum (migration 0067). String literals map
 * 1:1 to enum labels.
 */
export const IMPORT_RESOURCES = [
  "EMPLOYEE",
  "CLIENT",
  "PROJECT",
  "BUDGET_LINE",
] as const;

export type ImportResource = (typeof IMPORT_RESOURCES)[number];

export function isImportResource(v: string): v is ImportResource {
  return (IMPORT_RESOURCES as readonly string[]).includes(v);
}

/**
 * Column descriptor — used by the template generator + the UI's
 * "column reference" panel. Kept flat so it serialises to JSON without
 * fuss.
 */
export type ImportColumn = {
  /** Snake-cased key used in the parsed row map. */
  key: string;
  /** Human-readable header written to the template's first row. */
  label: string;
  /** Loose type hint for the UI + template validation. */
  type:
    | "string"
    | "email"
    | "phone"
    | "date"
    | "number"
    | "money"
    | "enum"
    | "ref"
    | "boolean";
  required: boolean;
  example: string;
  /** Enum values (when `type === "enum"`). */
  enumValues?: readonly string[];
  /** Ref info (when `type === "ref"`) — the label the UI should show for the "why". */
  refHint?: string;
};

export type RowError = {
  row_number: number; // 1-indexed data row (header excluded)
  field: string | null;
  message: string;
  raw?: string | null;
};

export type ValidatedRow<TCommit = Record<string, unknown>> = {
  row_number: number;
  /** Payload ready to hand to the committer. */
  commit: TCommit;
  /** The natural key used for upsert (e.g. email lowercased for employees). */
  key?: string;
};

export type ResourceValidationResult<TCommit> = {
  valid: ValidatedRow<TCommit>[];
  errors: RowError[];
};

/**
 * Sig for a resource's validator. Consumes raw rows (already parsed
 * out of CSV/XLSX) + a pre-loaded resolver, returns valid rows and
 * a per-row error list. Never throws for user data errors — only
 * throws for infra failures (should be rare).
 */
export type ResourceValidator<TCommit> = (input: {
  rows: RawRow[];
  maps: ResolverMaps;
  tenantId: string;
}) => Promise<ResourceValidationResult<TCommit>>;

/**
 * Sig for a resource's committer. Runs inside a single Supabase
 * request (transactional at the RPC level where possible). Returns
 * insert/update counts.
 */
export type ResourceCommitter<TCommit> = (input: {
  valid: ValidatedRow<TCommit>[];
  tenantId: string;
  createdBy: string;
  supabase: SupabaseClient;
}) => Promise<{ inserted: number; updated: number }>;

/**
 * Full descriptor per resource — powers both the runtime engine and
 * the UI's "column reference" panel.
 */
export type ImportAdapter<TCommit = Record<string, unknown>> = {
  resource: ImportResource;
  /** Grid vs single-row description (Budget lines = grid). */
  grid?: boolean;
  columns: readonly ImportColumn[];
  /** Which resolver maps to preload before validation. */
  needs: {
    lookups?: boolean;
    clients?: boolean;
    projects?: boolean;
    coa?: boolean;
    budgets?: boolean;
    employees?: boolean;
  };
  validate: ResourceValidator<TCommit>;
  commit: ResourceCommitter<TCommit>;
};
