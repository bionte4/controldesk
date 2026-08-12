import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type WorkShiftRow = {
  id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  duration_hours: number;
  shift_allowance_idr: number;
  is_night: boolean;
  is_active: boolean;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  is_base_catalog: boolean;
};

type RawShiftRow = {
  id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  duration: string;
  shift_allowance: number | string;
  is_night: boolean;
  is_active: boolean;
  project_id: string | null;
  project: { code: string; name: string } | null;
};

// `duration` comes back as either an ISO 8601 interval string like
// `08:00:00` OR `PT8H`, depending on server locale. Normalise to a
// decimal hours number so the UI can display it consistently.
function parseDurationHours(raw: string | null | undefined): number {
  if (!raw) return 0;
  // ISO-8601: "PT8H30M"
  const iso = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/u.exec(raw);
  if (iso) {
    return Number(iso[1] ?? 0) + Number(iso[2] ?? 0) / 60;
  }
  // "08:30:00" or "08:30"
  const parts = raw.split(":").map((p) => Number(p));
  if (parts.length >= 2) {
    return parts[0] + parts[1] / 60;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function mapRow(row: RawShiftRow): WorkShiftRow {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    start_time: row.start_time.slice(0, 5),
    end_time: row.end_time.slice(0, 5),
    duration_hours: parseDurationHours(row.duration),
    shift_allowance_idr: Number(row.shift_allowance ?? 0),
    is_night: row.is_night,
    is_active: row.is_active,
    project_id: row.project_id,
    project_code: row.project?.code ?? null,
    project_name: row.project?.name ?? null,
    is_base_catalog: row.project_id === null,
  };
}

/**
 * Return every shift visible to the caller — base catalog + all
 * project overrides in the tenant. Sorted so the base catalog
 * appears first, then project rows grouped by project code.
 */
export const listAllShifts = cache(async (): Promise<WorkShiftRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_shifts")
    .select(
      "id, code, name, start_time, end_time, duration, shift_allowance, is_night, is_active, project_id, project:project_id(code, name)",
    )
    .order("project_id", { ascending: true, nullsFirst: true })
    .order("code", { ascending: true })
    .limit(500);
  if (error || !data) return [];
  return (data as unknown as RawShiftRow[]).map(mapRow);
});

/**
 * Return only base-catalog shifts (`project_id IS NULL`). Used by
 * the roster form when no project is selected.
 */
export const listBaseShifts = cache(async (): Promise<WorkShiftRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_shifts")
    .select(
      "id, code, name, start_time, end_time, duration, shift_allowance, is_night, is_active, project_id, project:project_id(code, name)",
    )
    .is("project_id", null)
    .eq("is_active", true)
    .order("code", { ascending: true })
    .limit(50);
  if (error || !data) return [];
  return (data as unknown as RawShiftRow[]).map(mapRow);
});

/**
 * Return base + project-specific shifts for a roster form. Project
 * shifts take precedence when their `code` collides with a base
 * shift (i.e. the base row is filtered out for that code).
 */
export const listShiftsForRoster = cache(
  async (projectId: string | null): Promise<WorkShiftRow[]> => {
    const supabase = await createClient();
    let query = supabase
      .from("work_shifts")
      .select(
        "id, code, name, start_time, end_time, duration, shift_allowance, is_night, is_active, project_id, project:project_id(code, name)",
      )
      .eq("is_active", true);

    if (projectId) {
      query = query.or(`project_id.is.null,project_id.eq.${projectId}`);
    } else {
      query = query.is("project_id", null);
    }

    const { data, error } = await query
      .order("code", { ascending: true })
      .limit(200);
    if (error || !data) return [];
    const rows = (data as unknown as RawShiftRow[]).map(mapRow);

    // Deduplicate by code — project override wins over base.
    const byCode = new Map<string, WorkShiftRow>();
    for (const row of rows) {
      const prior = byCode.get(row.code);
      if (!prior || row.project_id !== null) byCode.set(row.code, row);
    }
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  },
);
