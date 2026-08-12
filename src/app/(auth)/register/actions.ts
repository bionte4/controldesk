"use server";

import { headers } from "next/headers";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { getRootDomain } from "@/lib/tenant/resolve";
import {
  createWorkspaceSchema,
  type CreateWorkspaceInput,
} from "@/lib/validation/tenant";

export type CreateWorkspaceResult =
  | { status: "error"; message: string }
  | { status: "success"; slug: string; loginUrl: string };

/**
 * Creates a brand new tenant + first TENANT_ADMIN employee. Only callable
 * from the apex domain — on a tenant subdomain user provisioning is
 * admin-driven (`HR_ADMIN` / `TENANT_ADMIN` will add employees from within
 * the workspace).
 */
export async function createWorkspace(
  input: CreateWorkspaceInput,
): Promise<CreateWorkspaceResult> {
  const parsed = createWorkspaceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid workspace details.",
    };
  }

  const { workspaceName, workspaceSlug, fullName, email, password } = parsed.data;

  const admin = createServiceRoleClient();

  // 1. Ensure slug is available.
  const { data: existing } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (existing) {
    return { status: "error", message: `Workspace "${workspaceSlug}" is already taken.` };
  }

  // 2. Create the auth user. `email_confirm: true` short-circuits the
  //    confirmation email so the admin can sign in immediately.
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (userError || !created.user) {
    return {
      status: "error",
      message: userError?.message ?? "Could not create the workspace admin.",
    };
  }

  // 3. Insert the tenant.
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({ slug: workspaceSlug, name: workspaceName })
    .select("id, slug")
    .single();

  if (tenantError || !tenant) {
    await admin.auth.admin.deleteUser(created.user.id);
    return {
      status: "error",
      message: tenantError?.message ?? "Could not create the workspace.",
    };
  }

  // 4. Insert the first employee (TENANT_ADMIN).
  const { error: employeeError } = await admin.from("employees").insert({
    tenant_id: tenant.id,
    user_id: created.user.id,
    role: "TENANT_ADMIN",
    reports_to_employee_id: null,
    full_name: fullName,
    email,
    is_active: true,
  });

  if (employeeError) {
    await admin.from("tenants").delete().eq("id", tenant.id);
    await admin.auth.admin.deleteUser(created.user.id);
    return {
      status: "error",
      message: employeeError.message,
    };
  }

  // 5. Build the tenant-scoped login URL so the client can hop domains.
  const rootDomain = getRootDomain();
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const loginUrl = `${proto}://${tenant.slug}.${rootDomain}/login`;

  return { status: "success", slug: tenant.slug, loginUrl };
}
