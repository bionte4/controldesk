import type { Metadata } from "next";
import Link from "next/link";
import {
  Archive,
  ArrowRight,
  BookOpen,
  KeyRound,
  ListTree,
  Plug,
  Scale,
  Settings as SettingsIcon,
  Sparkles,
  ToggleRight,
  Upload,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { requireCurrentEmployee } from "@/lib/auth/session";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";

export const metadata: Metadata = { title: "Settings" };

/**
 * Hub page for `/settings`.
 *
 * Two-tier layout (rules §17):
 *   1. **Personal** — "My preferences" card is visible to every
 *      authenticated user. It links to `/settings/preferences`
 *      where notification/telegram/whatsapp/appearance toggles live.
 *   2. **Administration** — a grid of admin tiles that only render
 *      for roles in the tile's `allowed` list. Roles must match the
 *      nav config exactly so a user cannot see a tile they cannot
 *      open. When the visible admin tile count is zero we hide the
 *      whole section header instead of showing an empty grid.
 *
 * Role-gate happens at render time only; each sub-route enforces its
 * own PDP check server-side (RLS + `requireCurrentEmployee` +
 * `notFound()` on mismatch). This page never mutates data.
 */
type TileKey =
  | "users"
  | "coa"
  | "lookups"
  | "approvalThresholds"
  | "features"
  | "bulkImport"
  | "integrations"
  | "secrets"
  | "archives";

type AdminTile = {
  key: TileKey;
  href: string;
  icon: LucideIcon;
  allowed: readonly AnyDbEmployeeRole[];
};

const ADMIN_TILES: readonly AdminTile[] = [
  {
    key: "users",
    href: "/settings/users",
    icon: UserCog,
    allowed: ["TENANT_ADMIN", "HR_ADMIN"],
  },
  {
    key: "coa",
    href: "/settings/coa",
    icon: BookOpen,
    allowed: ["TENANT_ADMIN", "LEAD_FINANCE"],
  },
  {
    key: "lookups",
    href: "/settings/lookups",
    icon: ListTree,
    allowed: ["TENANT_ADMIN", "GENERAL_MANAGER"],
  },
  {
    key: "approvalThresholds",
    href: "/settings/approval-thresholds",
    icon: Scale,
    // ADMIN + DIRECTOR (mapped from legacy `GENERAL_MANAGER`) may edit
    // per-tenant thresholds. RLS policy on `approval_thresholds` also
    // gates writes to canonical ADMIN/DIRECTOR — this list only decides
    // whether the tile renders in the hub.
    allowed: ["TENANT_ADMIN", "GENERAL_MANAGER"],
  },
  {
    key: "features",
    href: "/settings/features",
    icon: ToggleRight,
    // Read-only view — tenant admin sees which features are enabled
    // for their tenant. Toggling remains platform-admin only (Fase 3
    // + migration 0077 RLS). Mirrors the approval-thresholds gate so
    // TENANT_ADMIN + DIRECTOR see the tile.
    allowed: ["TENANT_ADMIN", "GENERAL_MANAGER"],
  },
  {
    key: "bulkImport",
    href: "/settings/bulk-import",
    icon: Upload,
    allowed: [
      "HR_ADMIN",
      "LEAD_FINANCE",
      "TENANT_ADMIN",
      "GENERAL_MANAGER",
      "HEAD_MANAGER",
      "OPERATIONS_MANAGER",
    ],
  },
  {
    key: "integrations",
    href: "/settings/integrations",
    icon: Plug,
    allowed: ["TENANT_ADMIN", "GENERAL_MANAGER"],
  },
  {
    key: "secrets",
    href: "/settings/secrets",
    icon: KeyRound,
    allowed: ["TENANT_ADMIN", "GENERAL_MANAGER"],
  },
  {
    key: "archives",
    href: "/settings/archives",
    icon: Archive,
    allowed: ["TENANT_ADMIN", "GENERAL_MANAGER"],
  },
] as const;

export default async function SettingsHubPage() {
  const employee = await requireCurrentEmployee();
  const t = await getTranslations("settingsHub");

  const role = employee.role as AnyDbEmployeeRole;
  const visibleAdminTiles = ADMIN_TILES.filter((tile) =>
    tile.allowed.includes(role),
  );

  // Precompute labels because next-intl's typed `t()` requires
  // string-literal keys, not dynamic `admin.tiles.${string}.title`
  // template literals.
  const tileLabels: Record<TileKey, { title: string; description: string }> = {
    users: {
      title: t("admin.tiles.users.title"),
      description: t("admin.tiles.users.description"),
    },
    coa: {
      title: t("admin.tiles.coa.title"),
      description: t("admin.tiles.coa.description"),
    },
    lookups: {
      title: t("admin.tiles.lookups.title"),
      description: t("admin.tiles.lookups.description"),
    },
    approvalThresholds: {
      title: t("admin.tiles.approvalThresholds.title"),
      description: t("admin.tiles.approvalThresholds.description"),
    },
    features: {
      title: t("admin.tiles.features.title"),
      description: t("admin.tiles.features.description"),
    },
    bulkImport: {
      title: t("admin.tiles.bulkImport.title"),
      description: t("admin.tiles.bulkImport.description"),
    },
    integrations: {
      title: t("admin.tiles.integrations.title"),
      description: t("admin.tiles.integrations.description"),
    },
    secrets: {
      title: t("admin.tiles.secrets.title"),
      description: t("admin.tiles.secrets.description"),
    },
    archives: {
      title: t("admin.tiles.archives.title"),
      description: t("admin.tiles.archives.description"),
    },
  };

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="label-meta">{t("kicker")}</p>
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary">
            <SettingsIcon className="size-5" aria-hidden />
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t("subtitle")}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {t("personal.heading")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("personal.description")}
          </p>
        </div>
        <Link
          href="/settings/preferences"
          className="group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-xl"
        >
          <Card className="glass transition-shadow group-hover:shadow-md">
            <CardContent className="flex items-start gap-4 p-5">
              <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="size-5" aria-hidden />
              </div>
              <div className="flex-1">
                <div className="font-medium">
                  {t("personal.preferences.title")}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {t("personal.preferences.description")}
                </p>
              </div>
              <ArrowRight
                className="mt-2 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </CardContent>
          </Card>
        </Link>
      </section>

      {visibleAdminTiles.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              {t("admin.heading")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("admin.description")}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleAdminTiles.map((tile) => {
              const Icon = tile.icon;
              const labels = tileLabels[tile.key];
              return (
                <Link
                  key={tile.key}
                  href={tile.href}
                  className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  <Card className="glass h-full transition-shadow group-hover:shadow-md">
                    <CardContent className="flex items-start gap-3 p-4">
                      <div className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
                        <Icon className="size-4" aria-hidden />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{labels.title}</div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {labels.description}
                        </p>
                      </div>
                      <ArrowRight
                        className="mt-1 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
