"use client";

/**
 * ControlDesk — Capability override history sheet
 * (rules §3, Fase 3B).
 *
 * Slide-over surface that shows the audit trail for one capability
 * (all roles or filtered to a single role). Consumed from
 * `CapabilityRow` via a "History" icon in each capability card
 * header.
 *
 * Data is fetched lazily on open via `loadCapabilityHistoryAction`
 * — no cost until the admin actually opens the sheet, and the
 * entries are re-fetched whenever the role filter changes so
 * "canary" test flows (grant → immediately open history) always
 * see the fresh row.
 */

import * as React from "react";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  Clock,
  History,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { CapabilityHistoryEntry } from "@/lib/rbac/capability-audit";
import type { CapabilityId } from "@/lib/rbac/capabilities";
import { EMPLOYEE_ROLES, type EmployeeRole } from "@/lib/rbac/roles";

import { loadCapabilityHistoryAction } from "./actions";

type Translator = (key: string, values?: Record<string, unknown>) => string;

const ALL_ROLES_VALUE = "__all__" as const;

const KIND_TONE: Record<CapabilityHistoryEntry["kind"], string> = {
  grant: "border-emerald-400/40 bg-emerald-500/15 text-emerald-300",
  revoke: "border-rose-400/40 bg-rose-500/15 text-rose-300",
  reset_cell: "border-indigo-400/40 bg-indigo-500/15 text-indigo-300",
  reset_all: "border-amber-400/40 bg-amber-500/15 text-amber-300",
};

const KIND_ICON: Record<CapabilityHistoryEntry["kind"], React.ReactNode> = {
  grant: <Check className="size-3.5" aria-hidden />,
  revoke: <X className="size-3.5" aria-hidden />,
  reset_cell: <RotateCcw className="size-3.5" aria-hidden />,
  reset_all: <RotateCcw className="size-3.5" aria-hidden />,
};

export function CapabilityHistorySheet({
  capabilityId,
  capabilityTitle,
  triggerLabel,
}: {
  capabilityId: CapabilityId;
  capabilityTitle: string;
  triggerLabel: string;
}) {
  const t = useTranslations("settings.capabilities") as unknown as Translator;
  const tRoles = useTranslations("roles") as unknown as Translator;

  const [open, setOpen] = React.useState(false);
  const [roleFilter, setRoleFilter] = React.useState<
    EmployeeRole | typeof ALL_ROLES_VALUE
  >(ALL_ROLES_VALUE);
  const [entries, setEntries] = React.useState<CapabilityHistoryEntry[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const fetchHistory = React.useCallback(
    (filter: EmployeeRole | typeof ALL_ROLES_VALUE) => {
      startTransition(async () => {
        try {
          setError(null);
          const result = await loadCapabilityHistoryAction({
            capability_id: capabilityId,
            role: filter === ALL_ROLES_VALUE ? undefined : filter,
            limit: 50,
          });
          if (!result.ok) {
            setError(result.reason);
            toast.error(t("history.errorLoad"), { description: result.reason });
            return;
          }
          setEntries(result.data);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          toast.error(t("history.errorLoad"), { description: message });
        }
      });
    },
    [capabilityId, startTransition, t],
  );

  React.useEffect(() => {
    if (!open) return;
    fetchHistory(roleFilter);
  }, [open, roleFilter, fetchHistory]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-xs"
            aria-label={triggerLabel}
          />
        }
      >
        <History className="size-3" aria-hidden />
        {t("history.trigger")}
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" aria-hidden />
            {t("history.title")}
          </SheetTitle>
          <SheetDescription>
            {t("history.subtitle", { capability: capabilityTitle })}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              {t("history.filterRole")}
            </span>
            <Select
              value={roleFilter}
              onValueChange={(value) =>
                setRoleFilter(value as EmployeeRole | typeof ALL_ROLES_VALUE)
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ROLES_VALUE}>
                  {t("history.filterAll")}
                </SelectItem>
                {EMPLOYEE_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {tRoles(role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {isPending ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("history.loading")}
            </div>
          ) : error ? (
            <p className="rounded-md border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              {error}
            </p>
          ) : entries.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {t("history.empty")}
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {entries.map((entry) => (
                <HistoryEntryCard
                  key={entry.id}
                  entry={entry}
                  t={t}
                  tRoles={tRoles}
                />
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function HistoryEntryCard({
  entry,
  t,
  tRoles,
}: {
  entry: CapabilityHistoryEntry;
  t: Translator;
  tRoles: Translator;
}) {
  const actor =
    entry.actor.fullName ??
    entry.actor.email ??
    t("history.actorUnknown");
  const timestamp = formatTimestamp(entry.createdAt);

  return (
    <li className="rounded-lg border border-border/60 bg-muted/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn("h-5 gap-1 text-[10px]", KIND_TONE[entry.kind])}
          >
            {KIND_ICON[entry.kind]}
            {t(`history.kind.${entry.kind}`)}
          </Badge>
          {entry.role ? (
            <Badge
              variant="outline"
              className="h-5 border-border/60 bg-background text-[10px]"
            >
              {tRoles(entry.role)}
            </Badge>
          ) : entry.kind === "reset_all" ? (
            <Badge
              variant="outline"
              className="h-5 border-border/60 bg-background text-[10px]"
            >
              {t("history.allRoles", { count: entry.clearedCount })}
            </Badge>
          ) : null}
        </div>
        <span className="text-[10px] text-muted-foreground">{timestamp}</span>
      </div>
      <p className="mt-2 text-xs text-foreground">
        {t("history.byActor", { actor })}
      </p>
    </li>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("id-ID", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
