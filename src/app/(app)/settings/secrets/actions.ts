"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { markSecretRotatedSchema } from "@/lib/validation/rotation";

/**
 * Mark a tracked secret as rotated (rules §22).
 *
 * Bumps `last_rotated_at = now()` on the given row and records the actor
 * in `last_rotated_by`. PDP `update` verb on `secret_rotation` limits
 * this to TENANT_ADMIN. Audit action `UPDATE` on `secret_rotations`.
 */
export const markSecretRotatedAction = withSecureAction({
  schema: markSecretRotatedSchema,
  resource: "secret_rotation",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "secret_rotations",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = createServiceRoleClient();

    const { data: prev } = await supabase
      .from("secret_rotations")
      .select("name, last_rotated_at, notes")
      .eq("name", input.name)
      .maybeSingle();

    if (!prev) {
      throw new Error(`unknown secret: ${input.name}`);
    }

    const rotatedAt = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("secret_rotations")
      .update({
        last_rotated_at: rotatedAt,
        last_rotated_by: ctx.actor.userId,
        notes: input.notes ?? prev.notes ?? null,
      })
      .eq("name", input.name);
    if (updateErr) throw new Error(updateErr.message);

    revalidatePath("/settings/secrets");

    return {
      result: {
        name: input.name,
        last_rotated_at: rotatedAt,
      },
      auditResourceId: input.name,
      auditOldValues: {
        last_rotated_at: prev.last_rotated_at,
        notes: prev.notes,
      },
      auditNewValues: {
        last_rotated_at: rotatedAt,
        notes: input.notes ?? prev.notes ?? null,
      },
    };
  },
});
