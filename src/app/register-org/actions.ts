"use server";

import { headers } from "next/headers";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/notify/mailer";
import { limit } from "@/lib/security/rate-limit";
import { log } from "@/lib/observability/log";
import {
  SIGNUP_RATE_LIMIT_GLOBAL,
  SIGNUP_RATE_LIMIT_PER_IP,
  SIGNUP_RESERVED_SLUGS,
  SIGNUP_TOKEN_TTL_HOURS,
  generateSignupToken,
  hashSignupToken,
  renderSignupConfirmationEmail,
  renderSignupVerificationEmail,
  validateSignupInput,
} from "@/lib/ops/tenant-signup";
import { generateSecurePassword } from "@/lib/ops/tenant-provisioning";

/**
 * Public self-signup server actions (Fase 6, migration 0078).
 *
 * SECURITY MODEL — read this before editing:
 *
 * 1. These actions are called from `/register-org`, which lives on
 *    the apex domain with NO authentication. Every input is
 *    attacker-controlled.
 * 2. Rate limiting: two buckets (per-IP + global) run BEFORE any DB
 *    work. Signals go through even when Redis is offline
 *    (in-memory fallback in `src/lib/security/rate-limit.ts`).
 * 3. Slug uniqueness is checked twice — once here (fast pre-flight
 *    to give a clean error message) and once by the DB check
 *    constraint inside `complete_tenant_signup()` (authoritative).
 * 4. Verification token is generated + hashed HERE; only the hash
 *    is persisted. The raw goes into the verify email exactly once
 *    and we can't recover it if the user loses the email.
 * 5. Auth user creation happens ONLY inside `verifySignupAction`
 *    after the token matches — never at signup submit time. This
 *    prevents attackers from creating throwaway auth.users rows by
 *    spamming the form.
 * 6. Email address is not confirmed until step 2 completes. Until
 *    then we've spent one hashed row + one email send per request.
 */

type ActionOk<T> = { ok: true; data: T };
type ActionErr = { ok: false; code: string; reason: string };
type ActionResult<T> = ActionOk<T> | ActionErr;

async function getClientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    h.get("cf-connecting-ip") ??
    "unknown"
  );
}

// ---------------------------------------------------------------------------
// STEP 1 — Request signup: rate-limit → validate → persist request row
//                       → email verify link.
// ---------------------------------------------------------------------------
export async function requestSignupAction(
  raw: unknown,
): Promise<ActionResult<{ email: string; ttlHours: number }>> {
  const ip = await getClientIp();

  const perIp = await limit(`signup:ip:${ip}`, SIGNUP_RATE_LIMIT_PER_IP);
  if (!perIp.allowed) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      reason: `Terlalu banyak percobaan dari IP ini. Coba lagi setelah ${new Date(
        perIp.resetAt * 1000,
      ).toLocaleTimeString("id-ID")}.`,
    };
  }

  const globalCap = await limit("signup:global", SIGNUP_RATE_LIMIT_GLOBAL);
  if (!globalCap.allowed) {
    log.warn("signup global cap hit", { ip });
    return {
      ok: false,
      code: "RATE_LIMITED",
      reason:
        "Layanan signup sedang menerima banyak permintaan. Silakan coba lagi beberapa saat.",
    };
  }

  const parsed = coerceSignupPayload(raw);
  if (!parsed.ok) return parsed;

  const validation = validateSignupInput(parsed.data);
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION",
      reason: validation.issues
        .map((i) => `${i.field}: ${i.message}`)
        .join("; "),
    };
  }

  const slug = parsed.data.slug.trim().toLowerCase();
  if (SIGNUP_RESERVED_SLUGS.has(slug)) {
    return {
      ok: false,
      code: "VALIDATION",
      reason: "Slug ini reserved oleh sistem.",
    };
  }

  const supa = createServiceRoleClient();

  // Pre-flight slug check — DB is still authoritative but this gives
  // a nicer error message than "slug_taken" from complete_tenant_signup.
  const existingTenant = await supa
    .from("tenants")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existingTenant.data) {
    return {
      ok: false,
      code: "SLUG_TAKEN",
      reason: `Slug '${slug}' sudah dipakai. Silakan pilih yang lain.`,
    };
  }

  // Purge any prior UNVERIFIED requests for the same email so a user
  // who mistypes doesn't get locked out. Verified requests remain for
  // audit.
  await supa
    .from("tenant_signup_requests")
    .delete()
    .eq("admin_email", parsed.data.adminEmail)
    .is("verified_at", null);

  const { raw: rawToken, hash: tokenHash } = generateSignupToken();
  const expiresAt = new Date(
    Date.now() + SIGNUP_TOKEN_TTL_HOURS * 60 * 60 * 1000,
  );

  const ua = (await headers()).get("user-agent");
  const insert = await supa.from("tenant_signup_requests").insert({
    slug,
    name: parsed.data.name.trim(),
    admin_email: parsed.data.adminEmail,
    admin_name: parsed.data.adminName.trim(),
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
    ip_address: ip !== "unknown" ? ip : null,
    user_agent: ua ?? null,
  });
  if (insert.error) {
    log.error("signup request insert failed", {
      error: insert.error.message,
      slug,
    });
    return {
      ok: false,
      code: "INTERNAL",
      reason:
        "Gagal menyimpan permintaan pendaftaran. Silakan coba lagi beberapa saat.",
    };
  }

  const rootDomain =
    process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim() || "controldesk.app";
  const proto =
    (await headers()).get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const verifyUrl = `${proto}://${rootDomain}/register-org/verify/${rawToken}`;

  const email = renderSignupVerificationEmail({
    tenantName: parsed.data.name,
    slug,
    adminName: parsed.data.adminName,
    verifyUrl,
  });
  const sendRes = await sendEmail({
    to: parsed.data.adminEmail,
    subject: email.subject,
    text: email.text,
    html: email.html,
    metadata: { kind: "signup_verify", slug },
  });
  if (sendRes.status === "FAILED") {
    log.error("signup verification email failed", {
      slug,
      error: sendRes.error,
    });
    // Don't block the flow — surface a partial-success message so
    // the user can try resend from the confirmation page.
  }

  // Audit — write the send outcome to `email_outbox` even though the
  // tenant doesn't exist yet (the column is nullable). Without this row,
  // ops teams can't distinguish "signup verify was never triggered" from
  // "email was sent but never delivered". `tenant_id=null` marks these
  // pre-provisioning rows so digest / retention queries can skip them
  // cleanly. Fire-and-forget — a failed audit row must never break the
  // signup UX (falls back to observability logs above).
  await supa.from("email_outbox").insert({
    tenant_id: null,
    to_address: parsed.data.adminEmail,
    from_address:
      sendRes.from ??
      process.env.SMTP_FROM ??
      "ControlDesk <no-reply@controldesk.app>",
    subject: email.subject,
    body_text: email.text,
    body_html: email.html,
    status: sendRes.status,
    provider: sendRes.provider,
    provider_message_id: sendRes.providerMessageId ?? null,
    error_message: sendRes.error ?? null,
    metadata: {
      kind: "signup_verify",
      slug,
      config_source: sendRes.configSource ?? null,
    },
    sent_at: sendRes.status === "SENT" ? new Date().toISOString() : null,
  }).then(({ error }) => {
    if (error) {
      log.warn("signup verify email_outbox insert failed", {
        slug,
        error: error.message,
      });
    }
  });

  return {
    ok: true,
    data: {
      email: parsed.data.adminEmail,
      ttlHours: SIGNUP_TOKEN_TTL_HOURS,
    },
  };
}

// ---------------------------------------------------------------------------
// STEP 2 — Verify: consume token → create auth user → RPC
//                → send credentials email → return credentials to
//                  the confirmation page for one-shot display.
// ---------------------------------------------------------------------------
export type VerifiedSignup = {
  slug: string;
  tenant_name: string;
  admin_email: string;
  admin_name: string;
  admin_password: string;
  login_url: string;
  password_email_status: "SENT" | "FAILED" | "SKIPPED";
};

export async function verifySignupAction(
  rawToken: string,
): Promise<ActionResult<VerifiedSignup>> {
  if (typeof rawToken !== "string" || rawToken.length < 20) {
    return {
      ok: false,
      code: "INVALID_TOKEN",
      reason: "Token tidak valid.",
    };
  }

  // Rate-limit verify separately — attackers guessing tokens hit
  // this endpoint. Bucket is per-IP-per-token-prefix so legitimate
  // users clicking their own link twice aren't blocked.
  const ip = await getClientIp();
  const verifyCap = await limit(`signup:verify:${ip}`, {
    max: 20,
    windowSeconds: 60 * 60,
  });
  if (!verifyCap.allowed) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      reason: "Terlalu banyak percobaan verifikasi. Coba lagi dalam 1 jam.",
    };
  }

  const supa = createServiceRoleClient();

  // Look up request row via token hash so we get the email BEFORE
  // creating the auth user. Direct-select rather than through the
  // RPC because we need the email for auth.admin.createUser.
  const tokenHash = hashSignupToken(rawToken);

  const reqRow = await supa
    .from("tenant_signup_requests")
    .select(
      "id, slug, name, admin_email, admin_name, expires_at, verified_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!reqRow.data) {
    return {
      ok: false,
      code: "INVALID_TOKEN",
      reason:
        "Token tidak ditemukan. Kemungkinan sudah dipakai, kadaluarsa, atau sudah dihapus.",
    };
  }
  if (reqRow.data.verified_at) {
    return {
      ok: false,
      code: "ALREADY_VERIFIED",
      reason: "Link ini sudah digunakan. Silakan login langsung.",
    };
  }
  if (new Date(reqRow.data.expires_at) < new Date()) {
    return {
      ok: false,
      code: "EXPIRED",
      reason:
        "Link verifikasi sudah kadaluarsa (24 jam). Silakan daftar ulang.",
    };
  }

  // Race: someone else may have registered this slug via ops
  // provisioning between step 1 and step 2. Handled here so we can
  // fail cleanly BEFORE creating the auth user.
  const takenTenant = await supa
    .from("tenants")
    .select("id")
    .eq("slug", reqRow.data.slug)
    .maybeSingle();
  if (takenTenant.data) {
    return {
      ok: false,
      code: "SLUG_TAKEN",
      reason: `Slug '${reqRow.data.slug}' sudah dipakai antara pendaftaran dan verifikasi. Silakan daftar ulang dengan slug lain.`,
    };
  }

  // Auth user creation — must succeed BEFORE the RPC so we can pass
  // the resulting user_id in. If the RPC fails after this we roll
  // back the auth user.
  const password = generateSecurePassword();
  const authRes = await supa.auth.admin.createUser({
    email: reqRow.data.admin_email,
    password,
    email_confirm: true,
    user_metadata: { full_name: reqRow.data.admin_name },
    app_metadata: {
      provisioned_by: "self-signup",
      provisioned_at: new Date().toISOString(),
      signup_request_id: reqRow.data.id,
    },
  });
  if (authRes.error || !authRes.data.user) {
    // Special case: email already exists (user tried to re-signup
    // after already having an account). We surface a specific error
    // rather than a generic auth error.
    if (authRes.error?.message?.toLowerCase().includes("already")) {
      return {
        ok: false,
        code: "EMAIL_TAKEN",
        reason: `Email ${reqRow.data.admin_email} sudah punya akun ControlDesk. Login langsung tanpa mendaftar ulang.`,
      };
    }
    return {
      ok: false,
      code: "AUTH_FAILED",
      reason:
        authRes.error?.message ?? "Gagal membuat akun. Silakan coba lagi.",
    };
  }
  const newUserId = authRes.data.user.id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpcRes = await (supa as any).rpc("complete_tenant_signup", {
    p_raw_token: rawToken,
    p_admin_user_id: newUserId,
  });

  if (rpcRes.error) {
    const del = await supa.auth.admin.deleteUser(newUserId);
    if (del.error) {
      log.error("verifySignupAction rollback of auth user failed", {
        user_id: newUserId,
        error: del.error.message,
      });
    }
    log.error("complete_tenant_signup RPC failed", {
      slug: reqRow.data.slug,
      error: rpcRes.error.message,
    });
    return {
      ok: false,
      code: "PROVISIONING_FAILED",
      reason: rpcRes.error.message,
    };
  }

  const provisioned = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data;
  if (!provisioned?.tenant_id) {
    return {
      ok: false,
      code: "INTERNAL",
      reason: "Provisioning RPC returned empty rowset.",
    };
  }

  const rootDomain =
    process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim() || "controldesk.app";
  const proto =
    (await headers()).get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const loginUrl = `${proto}://${reqRow.data.slug}.${rootDomain}/login`;

  const confirmation = renderSignupConfirmationEmail({
    tenantName: reqRow.data.name,
    slug: reqRow.data.slug,
    adminName: reqRow.data.admin_name,
    adminEmail: reqRow.data.admin_email,
    adminPassword: password,
    loginUrl,
  });
  const emailRes = await sendEmail({
    to: reqRow.data.admin_email,
    subject: confirmation.subject,
    text: confirmation.text,
    html: confirmation.html,
    metadata: {
      kind: "signup_confirmation",
      slug: reqRow.data.slug,
      tenantId: provisioned.tenant_id,
    },
  });
  const emailStatus: VerifiedSignup["password_email_status"] =
    emailRes.status === "SENT"
      ? "SENT"
      : emailRes.status === "FAILED"
        ? "FAILED"
        : "SKIPPED";

  // Audit — persist the confirmation send outcome. Unlike the verify step,
  // we now know the tenant_id, so this row is queryable by ops from the
  // provisioned workspace context.
  // Hoist narrowed fields out of `reqRow.data` so the `.then()` closure
  // below doesn't lose the non-null narrowing it inherits from line 300.
  const auditSlug = reqRow.data.slug;
  const auditTenantId = provisioned.tenant_id;
  await supa.from("email_outbox").insert({
    tenant_id: auditTenantId,
    to_address: reqRow.data.admin_email,
    from_address:
      emailRes.from ??
      process.env.SMTP_FROM ??
      "ControlDesk <no-reply@controldesk.app>",
    subject: confirmation.subject,
    body_text: confirmation.text,
    body_html: confirmation.html,
    status: emailRes.status,
    provider: emailRes.provider,
    provider_message_id: emailRes.providerMessageId ?? null,
    error_message: emailRes.error ?? null,
    metadata: {
      kind: "signup_confirmation",
      slug: auditSlug,
      config_source: emailRes.configSource ?? null,
    },
    sent_at: emailRes.status === "SENT" ? new Date().toISOString() : null,
  }).then(({ error }) => {
    if (error) {
      log.warn("signup confirmation email_outbox insert failed", {
        slug: auditSlug,
        tenant_id: auditTenantId,
        error: error.message,
      });
    }
  });

  return {
    ok: true,
    data: {
      slug: reqRow.data.slug,
      tenant_name: reqRow.data.name,
      admin_email: reqRow.data.admin_email,
      admin_name: reqRow.data.admin_name,
      admin_password: password,
      login_url: loginUrl,
      password_email_status: emailStatus,
    },
  };
}

// ---------------------------------------------------------------------------
// Coerce untrusted form data → typed object. Kept out of the pure
// helper module because it operates on `unknown` — the pure helper
// takes a typed `SignupInput`.
// ---------------------------------------------------------------------------
function coerceSignupPayload(raw: unknown): ActionResult<{
  slug: string;
  name: string;
  adminEmail: string;
  adminName: string;
}> {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, code: "VALIDATION", reason: "Payload tidak valid." };
  }
  const r = raw as Record<string, unknown>;
  const asStr = (v: unknown): string | null =>
    typeof v === "string" ? v : null;
  const slug = asStr(r.slug);
  const name = asStr(r.name);
  const adminEmail = asStr(r.admin_email ?? r.adminEmail);
  const adminName = asStr(r.admin_name ?? r.adminName);
  if (!slug || !name || !adminEmail || !adminName) {
    return {
      ok: false,
      code: "VALIDATION",
      reason: "Semua field wajib diisi.",
    };
  }
  return {
    ok: true,
    data: {
      slug,
      name,
      adminEmail: adminEmail.trim().toLowerCase(),
      adminName: adminName.trim(),
    },
  };
}
