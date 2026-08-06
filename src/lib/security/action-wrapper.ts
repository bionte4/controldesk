import { z } from "zod";

import { requireCurrentEmployee } from "@/lib/auth/session";
import {
  toCanonicalRole,
  toLegacyDbRole,
  type AnyDbEmployeeRole,
  type CanonicalRole,
} from "@/lib/rbac/roles";
import { recordAudit } from "@/lib/security/audit";
import {
  authorize,
  type ActionVerb,
  type Actor,
  type Decision,
  type ResourceAttributes,
  type ResourceType,
} from "@/lib/security/pdp";
import {
  authorizeCanonical,
  type CanonicalActionVerb,
  type CanonicalActor,
  type CanonicalAttributes,
  type CanonicalResource,
} from "@/lib/security/pdp-canonical";
import type { AuditActionType } from "@/types/database";

/**
 * HOF wrapper for Server Actions (rules §17.2 + §17.3).
 *
 * Guarantees for every wrapped action:
 *   1. The caller is an authenticated + active employee (redirect otherwise).
 *   2. Input is validated by a Zod schema.
 *   3. PDP `authorize()` is invoked BEFORE the handler runs.
 *   4. An audit log row is written AFTER the handler runs (with the
 *      handler's returned old/new snapshot).
 *
 * Handlers that need to skip the audit (pure reads) should just call the
 * underlying supabase client directly — this wrapper is intended for
 * MUTATING actions only.
 */

export type ActionResultOk<T> = {
  ok: true;
  data: T;
};

export type ActionResultErr = {
  ok: false;
  reason: string;
  code?:
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "VALIDATION"
    | "AUDIT_FAILED"
    | "INTERNAL";
};

export type ActionResult<T> = ActionResultOk<T> | ActionResultErr;

export type SecureActionContext = {
  actor: Actor;
  /**
   * Canonical (GAS-aligned 7-role) view of the same actor. Available for
   * handlers that want to reason in canonical terms without having to fold
   * the legacy role themselves. Populated for both legacy and canonical DB
   * role values.
   */
  canonicalRole: CanonicalRole;
};

export type SecureActionSnapshot<T> = {
  result: T;
  auditResourceId?: string | null;
  auditOldValues?: Record<string, unknown> | null;
  auditNewValues?: Record<string, unknown> | null;
  auditMetadata?: Record<string, unknown> | null;
};

export type SecureActionOptions<TSchema extends z.ZodTypeAny, TResult> = {
  /** The Zod schema validating the raw input. */
  schema: TSchema;
  /** ABAC + audit resource identifiers. */
  resource: ResourceType;
  action: ActionVerb;
  auditAction: AuditActionType;
  auditResourceName: string;
  /**
   * Extracts the ABAC attributes needed by the PDP from the (already
   * validated) input. Runs BEFORE authorize().
   */
  resolveAttributes: (
    input: z.infer<TSchema>,
    ctx: SecureActionContext,
  ) => ResourceAttributes | Promise<ResourceAttributes>;
  /**
   * The actual mutation. Should return a snapshot so `withSecureAction`
   * can write a rich audit row.
   */
  handler: (
    input: z.infer<TSchema>,
    ctx: SecureActionContext,
  ) => Promise<SecureActionSnapshot<TResult>>;
};

export function withSecureAction<TSchema extends z.ZodTypeAny, TResult>(
  options: SecureActionOptions<TSchema, TResult>,
) {
  return async function secureAction(
    rawInput: unknown,
  ): Promise<ActionResult<TResult>> {
    // 1. Auth.
    //
    // The DB `employee_role` enum accepts both legacy (10) and canonical (7)
    // values after migration 0021. Legacy `authorize()` still switches on the
    // 10 legacy values, so we fold canonical → legacy before handing the
    // actor to the PDP. Handlers that want canonical get `ctx.canonicalRole`.
    const employee = await requireCurrentEmployee();
    const rawRole = employee.role as AnyDbEmployeeRole;
    const canonicalRole = toCanonicalRole(rawRole);
    const actor: Actor = {
      userId: employee.user_id,
      employeeId: employee.id,
      role: toLegacyDbRole(canonicalRole),
      tenantId: employee.tenant_id,
    };

    // 2. Validate input.
    const parsed = options.schema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        reason:
          parsed.error.issues[0]?.message ?? "Input failed schema validation.",
      };
    }
    const input = parsed.data as z.infer<TSchema>;

    // 3. PDP check.
    const ctx: SecureActionContext = { actor, canonicalRole };
    const attributes = await options.resolveAttributes(input, ctx);
    const decision: Decision = authorize({
      actor,
      action: options.action,
      resource: options.resource,
      attributes,
    });
    if (decision.effect === "DENY") {
      return { ok: false, code: "FORBIDDEN", reason: decision.reason };
    }

    // 4. Execute the mutation.
    let snapshot: SecureActionSnapshot<TResult>;
    try {
      snapshot = await options.handler(input, ctx);
    } catch (err) {
      return {
        ok: false,
        code: "INTERNAL",
        reason: err instanceof Error ? err.message : "internal error",
      };
    }

    // 5. Audit trail. Any failure here is a hard error — the mutation may
    // have succeeded but we couldn't record it, which is unacceptable.
    try {
      await recordAudit({
        actionType: options.auditAction,
        resourceName: options.auditResourceName,
        resourceId: snapshot.auditResourceId ?? null,
        oldValues: snapshot.auditOldValues ?? null,
        newValues: snapshot.auditNewValues ?? null,
        metadata: snapshot.auditMetadata ?? null,
      });
    } catch (err) {
      return {
        ok: false,
        code: "AUDIT_FAILED",
        reason: err instanceof Error ? err.message : "audit failed",
      };
    }

    return { ok: true, data: snapshot.result };
  };
}

// ---------------------------------------------------------------------------
// Canonical HOF — parallel to `withSecureAction` but uses `authorizeCanonical`
// against the canonical resource enum. New GAS-imported modules (§15b) should
// prefer this variant so the PDP contract stays in canonical role space.
// ---------------------------------------------------------------------------

export type CanonicalSecureActionContext = {
  /**
   * Canonical actor (7-role folded). Prefer this in canonical handlers.
   * Legacy `Actor` (10-role) is available via `legacyActor` when a mixed
   * handler needs to talk to older code that still expects it.
   */
  actor: CanonicalActor;
  legacyActor: Actor;
};

export type CanonicalSecureActionOptions<TSchema extends z.ZodTypeAny, TResult> = {
  schema: TSchema;
  /**
   * The canonical PDP resource key. Provide a `CanonicalResource` string when
   * the resource is static across all inputs, or a function that computes
   * it from the validated input + resolved attributes — useful when one
   * Server Action services multiple polymorphic resources (e.g. general
   * vs field-ops cash advance, which live on the same table but map to
   * different PDP policies).
   */
  resource:
    | CanonicalResource
    | ((
        input: z.infer<TSchema>,
        attributes: CanonicalAttributes,
      ) => CanonicalResource);
  action: CanonicalActionVerb;
  auditAction: AuditActionType;
  auditResourceName: string;
  resolveAttributes: (
    input: z.infer<TSchema>,
    ctx: CanonicalSecureActionContext,
  ) => CanonicalAttributes | Promise<CanonicalAttributes>;
  handler: (
    input: z.infer<TSchema>,
    ctx: CanonicalSecureActionContext,
  ) => Promise<SecureActionSnapshot<TResult>>;
};

/**
 * Type-safe list of canonical roles the caller allows to invoke this action.
 * Useful for a coarse pre-PDP gate (e.g. "budget authoring is PM/OM/DIRECTOR
 * only") without duplicating the resource-level rules inside `pdp-canonical`.
 * Prefer letting the PDP be the source of truth; use this only for defense-
 * in-depth or when composing multi-tenant scripts.
 */
export function requireCanonicalRoles(
  actor: CanonicalActor,
  allowed: readonly CanonicalRole[],
): Decision {
  if (actor.role === "ADMIN") {
    return { effect: "ALLOW", reason: "admin override" };
  }
  return allowed.includes(actor.role)
    ? { effect: "ALLOW", reason: `${actor.role} allowed` }
    : { effect: "DENY", reason: `role ${actor.role} not in ${allowed.join(", ")}` };
}

export function withCanonicalSecureAction<TSchema extends z.ZodTypeAny, TResult>(
  options: CanonicalSecureActionOptions<TSchema, TResult>,
) {
  return async function secureCanonicalAction(
    rawInput: unknown,
  ): Promise<ActionResult<TResult>> {
    // 1. Auth — build BOTH actor shapes so canonical handlers can talk to
    //    legacy helpers if they need to.
    const employee = await requireCurrentEmployee();
    const rawRole = employee.role as AnyDbEmployeeRole;
    const canonicalRole = toCanonicalRole(rawRole);
    const legacyActor: Actor = {
      userId: employee.user_id,
      employeeId: employee.id,
      role: toLegacyDbRole(canonicalRole),
      tenantId: employee.tenant_id,
    };
    const canonicalActor: CanonicalActor = {
      userId: employee.user_id,
      employeeId: employee.id,
      role: canonicalRole,
      tenantId: employee.tenant_id,
    };

    // 2. Validate.
    const parsed = options.schema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        reason:
          parsed.error.issues[0]?.message ?? "Input failed schema validation.",
      };
    }
    const input = parsed.data as z.infer<TSchema>;

    // 3. PDP.
    const ctx: CanonicalSecureActionContext = {
      actor: canonicalActor,
      legacyActor,
    };
    const attributes = await options.resolveAttributes(input, ctx);
    const resolvedResource: CanonicalResource =
      typeof options.resource === "function"
        ? options.resource(input, attributes)
        : options.resource;
    const decision: Decision = authorizeCanonical({
      actor: canonicalActor,
      action: options.action,
      resource: resolvedResource,
      attributes,
    });
    if (decision.effect === "DENY") {
      return { ok: false, code: "FORBIDDEN", reason: decision.reason };
    }

    // 4. Execute.
    let snapshot: SecureActionSnapshot<TResult>;
    try {
      snapshot = await options.handler(input, ctx);
    } catch (err) {
      return {
        ok: false,
        code: "INTERNAL",
        reason: err instanceof Error ? err.message : "internal error",
      };
    }

    // 5. Audit.
    try {
      await recordAudit({
        actionType: options.auditAction,
        resourceName: options.auditResourceName,
        resourceId: snapshot.auditResourceId ?? null,
        oldValues: snapshot.auditOldValues ?? null,
        newValues: snapshot.auditNewValues ?? null,
        metadata: snapshot.auditMetadata ?? null,
      });
    } catch (err) {
      return {
        ok: false,
        code: "AUDIT_FAILED",
        reason: err instanceof Error ? err.message : "audit failed",
      };
    }

    return { ok: true, data: snapshot.result };
  };
}
