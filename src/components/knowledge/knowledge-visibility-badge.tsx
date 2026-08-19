import { Globe, Lock, Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import {
  CANONICAL_ROLE_LABELS,
  type AnyDbEmployeeRole,
  type CanonicalRole,
} from "@/lib/rbac/roles";
import type { KnowledgeArticleVisibility } from "@/lib/validation/knowledge-article";

/**
 * Compact visibility badge shared by the reader header and the list
 * cards. Renders one of:
 *
 *   • TENANT_WIDE   — muted "Everyone" badge (or hidden — see prop).
 *   • ROLE_GATED    — indigo "Roles · A, B" badge with a Users icon.
 *   • PROJECT_SCOPED — emerald "Project · <name>" badge with a Lock
 *                     icon. Falls back to just the badge label when
 *                     the caller couldn't resolve the project name
 *                     (e.g. deleted project → name = null).
 *
 * i18n:
 *   • Label prefix comes from `knowledge.visibility.badge.<mode>`.
 *   • Role labels come from `CANONICAL_ROLE_LABELS`. If the stored
 *     value doesn't match a canonical (legacy fixture data), fall
 *     back to the raw string.
 *
 * The component is a server component (no hooks tied to state) so
 * it can be rendered directly from an RSC page without a `use
 * client` boundary.
 */
export function KnowledgeVisibilityBadge({
  visibility,
  roles,
  projectName,
  /**
   * When true, the TENANT_WIDE state is hidden entirely — cleaner
   * for card lists where "Everyone" is the default and doesn't need
   * to shout. Reader page passes false to keep the trio consistent.
   */
  hideTenantWide = false,
}: {
  visibility: KnowledgeArticleVisibility;
  roles: readonly string[];
  projectName: string | null;
  hideTenantWide?: boolean;
}) {
  const t = useTranslations("knowledge.visibility.badge");

  if (visibility === "TENANT_WIDE") {
    if (hideTenantWide) return null;
    return (
      <Badge
        variant="outline"
        className="gap-1 border-muted-foreground/30 text-muted-foreground"
      >
        <Globe className="size-3" aria-hidden />
        {t("TENANT_WIDE")}
      </Badge>
    );
  }

  if (visibility === "ROLE_GATED") {
    // Deduplicate + render role labels. Legacy DB strings that don't
    // fold into `CANONICAL_ROLE_LABELS` render as-is so we never lose
    // the raw value from the badge.
    const labels = Array.from(new Set(roles.map(labelForRole)));
    return (
      <Badge
        variant="outline"
        className="gap-1 border-indigo-500/40 text-indigo-600 dark:text-indigo-400"
      >
        <Users className="size-3" aria-hidden />
        {t("ROLE_GATED")}
        {labels.length > 0 ? ` · ${labels.join(", ")}` : ""}
      </Badge>
    );
  }

  // PROJECT_SCOPED
  return (
    <Badge
      variant="outline"
      className="gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
    >
      <Lock className="size-3" aria-hidden />
      {t("PROJECT_SCOPED")}
      {projectName ? ` · ${projectName}` : ""}
    </Badge>
  );
}

function labelForRole(role: string): string {
  return (
    CANONICAL_ROLE_LABELS[role as CanonicalRole] ??
    LEGACY_ROLE_LABELS[role as AnyDbEmployeeRole] ??
    role
  );
}

// Legacy DB name shortlist — only the ones an author is most likely
// to reach in the picker's canonical selection. Keeps the badge
// short: "PROJECT_MANAGER" as a badge line is ugly.
const LEGACY_ROLE_LABELS: Partial<Record<AnyDbEmployeeRole, string>> = {
  EMPLOYEE: "Employee",
  SUPERVISOR: "Supervisor",
  PROJECT_MANAGER: "PM",
  OPERATIONS_MANAGER: "OM",
  HEAD_MANAGER: "Head Manager",
  GENERAL_MANAGER: "GM",
  PETTY_CASH_CUSTODIAN: "PCC",
  LEAD_FINANCE: "Finance",
  HR_ADMIN: "HR",
  TENANT_ADMIN: "Admin",
};
