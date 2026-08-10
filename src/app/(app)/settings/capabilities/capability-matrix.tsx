"use client";

/**
 * ControlDesk — Admin capability toggle matrix (rules §3 Fase 2).
 *
 * Renders one card per capability with a compact role × grant grid.
 * Each cell has one of four states:
 *
 *   default-allow    ✓ (muted)    — catalog default is ALLOW, no override
 *   default-deny     · (muted)    — catalog default is DENY, no override
 *   override-allow   ✓ (indigo)   — tenant admin explicitly granted
 *   override-deny    ✕ (rose)     — tenant admin explicitly revoked
 *
 * Clicking a cell cycles: default → override-allow → override-deny → default.
 * The transition to "default" calls `resetCapabilityOverrideAction` which
 * deletes the row entirely; the ALLOW/DENY overrides upsert the row.
 *
 * The `granted` value chosen depends on the current state:
 *   • default-allow → click → override-deny (admin wants to revoke)
 *   • default-deny  → click → override-allow (admin wants to grant)
 *   • override-*    → click → reset (revert to catalog default)
 *
 * This gives every cell a 3-position rotor without a dropdown menu,
 * keeping the matrix keyboard- and screen-reader-friendly.
 */

import * as React from "react";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Check, RotateCcw, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CapabilityCellState } from "@/lib/rbac/capability-resolver";
import type {
  CapabilityCategory,
  CapabilityId,
  CapabilitySensitivity,
} from "@/lib/rbac/capabilities";
import { EMPLOYEE_ROLES, type EmployeeRole } from "@/lib/rbac/roles";

import {
  resetCapabilityAction,
  resetCapabilityOverrideAction,
  upsertCapabilityOverrideAction,
} from "./actions";

export type CapabilityCellSnapshot = {
  role: EmployeeRole;
  state: CapabilityCellState;
};

export type CapabilityRowState = {
  id: CapabilityId;
  category: CapabilityCategory;
  sensitivity: CapabilitySensitivity;
  title: string;
  description: string;
  defaultRoles: EmployeeRole[];
  cells: CapabilityCellSnapshot[];
  overrideCount: number;
  latestOverrideAt: string | null;
};

const SENSITIVITY_TONE: Record<CapabilitySensitivity, string> = {
  low: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
  medium: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  high: "border-rose-400/30 bg-rose-500/10 text-rose-300",
};

const CELL_TONE: Record<CapabilityCellState, string> = {
  "default-allow":
    "border-muted-foreground/20 bg-muted/40 text-muted-foreground hover:bg-muted/60",
  "default-deny":
    "border-dashed border-muted-foreground/20 bg-transparent text-muted-foreground/70 hover:bg-muted/40",
  "override-allow":
    "border-emerald-400/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25",
  "override-deny":
    "border-rose-400/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25",
};

const ROLE_ORDER: readonly EmployeeRole[] = EMPLOYEE_ROLES;

export function CapabilityMatrix({
  rows,
}: {
  rows: CapabilityRowState[];
}) {
  const t = useTranslations("settings.capabilities");
  const tRoles = useTranslations("roles");

  const grouped = React.useMemo(() => {
    const groups: Record<CapabilityCategory, CapabilityRowState[]> = {
      finance: [],
      hr: [],
      operations: [],
      strategy: [],
    };
    for (const row of rows) {
      groups[row.category].push(row);
    }
    return groups;
  }, [rows]);

  return (
    <div className="flex flex-col gap-6">
      {(
        ["finance", "hr", "operations", "strategy"] as CapabilityCategory[]
      ).map((category) =>
        grouped[category].length > 0 ? (
          <section key={category} className="flex flex-col gap-3">
            <h2 className="font-display text-sm font-semibold text-muted-foreground">
              {t(`category.${category}`)}
            </h2>
            <div className="flex flex-col gap-3">
              {grouped[category].map((row) => (
                <CapabilityRow
                  key={row.id}
                  row={row}
                  t={t as unknown as Translator}
                  tRoles={tRoles as unknown as Translator}
                />
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}

// Loose translator signature — `next-intl`'s typed return type is
// deeply recursive and blows TS's inference budget when embedded
// as a component prop. The parent component already knows the
// exact namespace; this local widen keeps `<CapabilityRow>` simple
// without giving up runtime correctness (all keys are checked at
// the call site).
type Translator = (key: string, values?: Record<string, unknown>) => string;

function CapabilityRow({
  row,
  t,
  tRoles,
}: {
  row: CapabilityRowState;
  t: Translator;
  tRoles: Translator;
}) {
  const [isPending, startTransition] = useTransition();

  const handleCellClick = React.useCallback(
    (cell: CapabilityCellSnapshot) => {
      // High-sensitivity capabilities show a browser confirm before
      // any grant is applied so a stray click on payroll doesn't
      // silently expand access. Revokes + reverts still go straight
      // through — narrowing access is always safe.
      if (
        row.sensitivity === "high" &&
        cell.state !== "override-allow" &&
        // Predict the target state: default-deny → override-allow (grant)
        (cell.state === "default-deny" || cell.state === "override-deny")
      ) {
        const confirmed = window.confirm(
          t("confirmGrantHigh", { role: tRoles(cell.role) }),
        );
        if (!confirmed) return;
      }

      startTransition(async () => {
        try {
          let result;
          if (
            cell.state === "override-allow" ||
            cell.state === "override-deny"
          ) {
            // Revert this cell to catalog default.
            result = await resetCapabilityOverrideAction({
              capability_id: row.id,
              role: cell.role,
            });
          } else if (cell.state === "default-allow") {
            // Catalog says ALLOW, admin wants to revoke → explicit DENY.
            result = await upsertCapabilityOverrideAction({
              capability_id: row.id,
              role: cell.role,
              granted: false,
            });
          } else {
            // default-deny → explicit ALLOW.
            result = await upsertCapabilityOverrideAction({
              capability_id: row.id,
              role: cell.role,
              granted: true,
            });
          }
          if (!result.ok) {
            toast.error(t("errorSave"), { description: result.reason });
            return;
          }
          toast.success(t("saved"));
        } catch (err) {
          toast.error(t("errorSave"), {
            description: err instanceof Error ? err.message : String(err),
          });
        }
      });
    },
    [row.id, row.sensitivity, startTransition, t, tRoles],
  );

  const handleResetCapability = React.useCallback(() => {
    const confirmed = window.confirm(t("confirmResetCapability"));
    if (!confirmed) return;
    startTransition(async () => {
      try {
        const result = await resetCapabilityAction({ capability_id: row.id });
        if (!result.ok) {
          toast.error(t("errorSave"), { description: result.reason });
          return;
        }
        toast.success(t("resetDone", { count: result.data.cleared }));
      } catch (err) {
        toast.error(t("errorSave"), {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }, [row.id, startTransition, t]);

  const cellByRole = React.useMemo(() => {
    const map = new Map<EmployeeRole, CapabilityCellSnapshot>();
    for (const c of row.cells) map.set(c.role, c);
    return map;
  }, [row.cells]);

  return (
    <Card className="glass">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              {row.title}
              <Badge
                variant="outline"
                className={cn("h-5 text-[10px]", SENSITIVITY_TONE[row.sensitivity])}
              >
                {row.sensitivity === "high" && (
                  <AlertTriangle className="mr-1 size-3" aria-hidden />
                )}
                {t(`sensitivity.${row.sensitivity}`)}
              </Badge>
              {row.overrideCount > 0 ? (
                <Badge
                  variant="outline"
                  className="h-5 border-indigo-400/30 bg-indigo-500/10 text-[10px] text-indigo-300"
                >
                  {t("overrideCountShort", { count: row.overrideCount })}
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              {row.description}
            </CardDescription>
          </div>
          {row.overrideCount > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleResetCapability}
              disabled={isPending}
              className="gap-1 text-xs"
            >
              <RotateCcw className="size-3" aria-hidden />
              {t("resetCapability")}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${ROLE_ORDER.length}, minmax(96px, 1fr))`,
          }}
          role="grid"
          aria-label={row.title}
        >
          {ROLE_ORDER.map((role) => {
            const cell = cellByRole.get(role);
            if (!cell) return null;
            const isAllow =
              cell.state === "default-allow" || cell.state === "override-allow";
            return (
              <button
                key={role}
                type="button"
                onClick={() => handleCellClick(cell)}
                disabled={isPending}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-3 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-70",
                  CELL_TONE[cell.state],
                )}
                aria-label={`${row.title} — ${tRoles(role)}: ${t(
                  `cellState.${cell.state}`,
                )}`}
                aria-pressed={isAllow}
                title={t(`cellHint.${cell.state}`)}
              >
                <span className="truncate text-center font-medium">
                  {tRoles(role)}
                </span>
                <span className="inline-flex items-center gap-1">
                  {isAllow ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : (
                    <X className="size-3.5" aria-hidden />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
