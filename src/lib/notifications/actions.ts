"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * ControlDesk notification mark-as-read actions (rules §20).
 *
 * Not wrapped with `withSecureAction()` because:
 *  - No PDP branching needed: RLS restricts UPDATE to `user_id = auth.uid()`.
 *  - Read receipts are not part of the immutable audit trail.
 *
 * Both actions verify auth via `requireCurrentEmployee()` and rely on
 * Supabase RLS as the final gate against cross-tenant reads/writes.
 */

export async function markNotificationRead(
  id: string,
): Promise<{ ok: boolean; reason?: string }> {
  const employee = await requireCurrentEmployee();
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", employee.user_id)
    .is("read_at", null);
  if (error) return { ok: false, reason: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const employee = await requireCurrentEmployee();
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", employee.user_id)
    .is("read_at", null);
  if (error) return { ok: false, reason: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
