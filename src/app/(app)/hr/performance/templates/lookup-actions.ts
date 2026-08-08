"use server";

import { z } from "zod";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Fetch a single evaluation template + its items for the editor.
 * Kept separate from mutation actions because the list page does not
 * pre-hydrate items — we lazy-load them when the user clicks Edit.
 */

const idSchema = z.object({ id: z.string().uuid() });

export type TemplateForEditItem = {
  id: string;
  seq: number;
  name: string;
  description: string | null;
  /**
   * Postgres numeric returns as string in supabase-js v2, but the
   * generated types now surface `number` for `weight_pct`. Accept
   * both to stay resilient across type regenerations — the client
   * coerces via `Number()`.
   */
  weight_pct: string | number;
  question_type: "SCORE_1_5" | "TEXT";
  is_required: boolean;
};

export async function fetchTemplateForEdit(input: { id: string }): Promise<
  | {
      ok: true;
      data: {
        id: string;
        name: string;
        description: string | null;
        is_active: boolean;
        items: TemplateForEditItem[];
      };
    }
  | { ok: false; reason: string }
> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "Invalid template id." };
  const employee = await requireCurrentEmployee();
  const supabase = await createClient();

  const [{ data: tpl, error: tplErr }, { data: items, error: itemsErr }] =
    await Promise.all([
      supabase
        .from("evaluation_templates")
        .select("id, name, description, is_active")
        .eq("id", parsed.data.id)
        .eq("tenant_id", employee.tenant_id)
        .maybeSingle(),
      supabase
        .from("evaluation_template_items")
        .select(
          "id, seq, name, description, weight_pct, question_type, is_required",
        )
        .eq("template_id", parsed.data.id)
        .eq("tenant_id", employee.tenant_id)
        .order("seq", { ascending: true }),
    ]);
  if (tplErr) return { ok: false, reason: tplErr.message };
  if (!tpl) return { ok: false, reason: "Template not found." };
  if (itemsErr) return { ok: false, reason: itemsErr.message };

  return {
    ok: true,
    data: {
      id: tpl.id,
      name: tpl.name,
      description: tpl.description,
      is_active: tpl.is_active,
      items: (items ?? []) as TemplateForEditItem[],
    },
  };
}
