"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  SkipForward,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatInTz } from "@/lib/format/date";
import type {
  CalendarConnectionStatus,
  CalendarSyncCounters,
  CalendarSyncEvent,
  CalendarSyncStatus,
} from "@/lib/data/calendar-sync";
import {
  skipEventSchema,
  type SkipEventInput,
} from "@/lib/validation/calendar-sync";

import {
  retryCalendarEventAction,
  runCalendarReconciliationAction,
  skipCalendarEventAction,
} from "./actions";

/**
 * Interactive dashboard for the Google Calendar sync outbox.
 * Renders the four KPI counters, a filterable sync-map table with
 * per-row retry/skip actions, and the "how sync works" info panel.
 *
 * Data flow: RSC provides `initialEvents` + `counters` + `connection`.
 * Local mutations (retry / skip / reconcile) call server actions
 * which `revalidatePath()` → RSC refetches → props re-hydrate.
 * We keep a light client-side state for the status filter only.
 */
type FilterValue = "ALL" | CalendarSyncStatus;

export function CalendarSyncPanel({
  connection,
  counters,
  initialEvents,
  lastSync,
}: {
  connection: CalendarConnectionStatus;
  counters: CalendarSyncCounters;
  initialEvents: CalendarSyncEvent[];
  lastSync: string | null;
}) {
  const t = useTranslations("calendarSync");
  const router = useRouter();
  const [filter, setFilter] = React.useState<FilterValue>("ALL");
  const [isReconciling, startReconcile] = React.useTransition();
  const [reconcileOpen, setReconcileOpen] = React.useState(false);

  const filteredEvents = React.useMemo(
    () =>
      filter === "ALL"
        ? initialEvents
        : initialEvents.filter((e) => e.status === filter),
    [initialEvents, filter],
  );

  function runReconciliation() {
    startReconcile(async () => {
      const res = await runCalendarReconciliationAction({});
      if (!res.ok) {
        toast.error(res.reason ?? t("toasts.reconcileFailed"));
        return;
      }
      toast.success(
        res.data.count === 0
          ? t("toasts.reconcileNothing")
          : t("toasts.reconcileOk", { count: res.data.count }),
      );
      setReconcileOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Row 1: Header actions + Connection status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ConnectionStatusPill connection={connection} />
        <Dialog open={reconcileOpen} onOpenChange={setReconcileOpen}>
          <DialogTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={!connection.connected}
              >
                <RefreshCw className="size-3.5" />
                {t("actions.runReconciliation")}
              </Button>
            }
          />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("reconcileDialog.title")}</DialogTitle>
              <DialogDescription>
                {t("reconcileDialog.description", { count: counters.failed })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setReconcileOpen(false)}
                disabled={isReconciling}
              >
                {t("actions.cancel")}
              </Button>
              <Button
                type="button"
                onClick={runReconciliation}
                disabled={isReconciling}
              >
                {isReconciling ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 size-4" />
                )}
                {t("reconcileDialog.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Row 2: KPI counters */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("kpis.synced")}
          value={counters.sent}
          tone="success"
        />
        <KpiCard
          label={t("kpis.pending")}
          value={counters.pending}
          tone="info"
        />
        <KpiCard
          label={t("kpis.failed")}
          value={counters.failed}
          tone="danger"
        />
        <KpiCard
          label={t("kpis.skipped")}
          value={counters.skipped}
          tone="muted"
        />
      </div>

      {/* Row 3: Sync map */}
      <Card className="glass">
        <CardContent className="flex flex-col gap-4 p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">{t("syncMap.title")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("syncMap.lastSync", {
                  when: lastSync
                    ? formatInTz(lastSync, "dd MMM yyyy, HH:mm")
                    : "—",
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={filter}
                onValueChange={(v) => setFilter(v as FilterValue)}
              >
                <SelectTrigger className="h-8 w-[160px]" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t("filter.all")}</SelectItem>
                  <SelectItem value="SENT">{t("filter.sent")}</SelectItem>
                  <SelectItem value="PENDING">
                    {t("filter.pending")}
                  </SelectItem>
                  <SelectItem value="FAILED">{t("filter.failed")}</SelectItem>
                  <SelectItem value="SKIPPED">
                    {t("filter.skipped")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t("actions.refresh")}
                onClick={() => router.refresh()}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-card/30 p-8 text-center text-sm text-muted-foreground">
              {filter === "ALL"
                ? t("syncMap.emptyAll")
                : t("syncMap.emptyFiltered")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">
                      {t("syncMap.col.type")}
                    </th>
                    <th className="pb-2 pr-3 font-medium">
                      {t("syncMap.col.project")}
                    </th>
                    <th className="pb-2 pr-3 font-medium">
                      {t("syncMap.col.subject")}
                    </th>
                    <th className="pb-2 pr-3 font-medium">
                      {t("syncMap.col.dates")}
                    </th>
                    <th className="pb-2 pr-3 font-medium">
                      {t("syncMap.col.status")}
                    </th>
                    <th className="pb-2 pr-3 font-medium">
                      {t("syncMap.col.lastSynced")}
                    </th>
                    <th className="pb-2 text-right font-medium">
                      {t("syncMap.col.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event) => (
                    <SyncMapRow
                      key={event.id}
                      event={event}
                      calendarId={
                        connection.connected ? connection.calendarId : null
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row 4: How it works */}
      <Card className="glass border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div className="flex flex-col gap-1.5">
            <p className="font-medium">{t("howItWorks.title")}</p>
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              <li>{t("howItWorks.bullet1")}</li>
              <li>{t("howItWorks.bullet2")}</li>
              <li>{t("howItWorks.bullet3")}</li>
              <li>{t("howItWorks.bullet4")}</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (kept in-file because they only exist for this dashboard)
// ---------------------------------------------------------------------------

function ConnectionStatusPill({
  connection,
}: {
  connection: CalendarConnectionStatus;
}) {
  const t = useTranslations("calendarSync.connection");
  if (connection.connected) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
        <span className="font-medium">{t("connected")}</span>
        <span className="text-muted-foreground">
          · {connection.clientEmail ?? connection.calendarId}
        </span>
      </div>
    );
  }
  const label =
    connection.reason === "no_env"
      ? t("noEnv")
      : connection.reason === "no_creds"
        ? t("noCreds")
        : t("inactive");
  const hint =
    connection.reason === "no_env"
      ? t("noEnvHint")
      : connection.reason === "no_creds"
        ? t("noCredsHint")
        : (connection.inactiveDetail?.lastError ?? t("inactiveHint"));
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <div className="flex items-center gap-2">
        <AlertCircle
          className="size-4 text-amber-500"
          aria-hidden
        />
        <span className="font-medium">{label}</span>
      </div>
      <span className="pl-6 text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "info" | "danger" | "muted";
}) {
  const dotColor =
    tone === "success"
      ? "bg-emerald-500"
      : tone === "info"
        ? "bg-blue-500"
        : tone === "danger"
          ? "bg-rose-500"
          : "bg-muted-foreground/40";
  return (
    <Card className="glass">
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`size-2 rounded-full ${dotColor}`} aria-hidden />
          {label}
        </div>
        <div className="font-display text-3xl font-semibold tabular-nums">
          {value.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}

function SyncMapRow({
  event,
  calendarId,
}: {
  event: CalendarSyncEvent;
  calendarId: string | null;
}) {
  const t = useTranslations("calendarSync");
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [skipOpen, setSkipOpen] = React.useState(false);

  const isMilestone = event.kind.startsWith("MILESTONE_");
  const type = isMilestone ? t("kind.milestone") : t("kind.project");
  const subject = isMilestone
    ? (event.milestone?.name ?? "—")
    : (event.project?.name ?? "—");

  const start = event.project?.startDate ?? null;
  const end = isMilestone
    ? (event.milestone?.dueDate ?? null)
    : (event.project?.endDate ?? null);
  const dates = start && end ? `${start} → ${end}` : start ? start : end ?? "—";

  const projectRef =
    event.project?.projectNumber ?? event.project?.name ?? "—";
  const lastSynced = event.sentAt
    ? formatInTz(event.sentAt, "dd MMM yyyy, HH:mm")
    : event.status === "PENDING"
      ? t("syncMap.pendingScheduled")
      : "—";

  function onRetry() {
    startTransition(async () => {
      const res = await retryCalendarEventAction({ eventId: event.id });
      if (!res.ok) {
        toast.error(res.reason ?? t("toasts.retryFailed"));
        return;
      }
      toast.success(t("toasts.retryOk"));
      router.refresh();
    });
  }

  const canOpenInGoogle =
    event.status === "SENT" && event.googleEventId && calendarId;

  return (
    <tr className="border-t border-border/40">
      <td className="py-2.5 pr-3">
        <Badge variant="outline" className="font-normal">
          {type}
        </Badge>
      </td>
      <td className="py-2.5 pr-3 text-xs font-medium">{projectRef}</td>
      <td className="py-2.5 pr-3 max-w-[240px] truncate" title={subject}>
        {subject}
      </td>
      <td className="py-2.5 pr-3 text-xs tabular-nums text-muted-foreground">
        {dates}
      </td>
      <td className="py-2.5 pr-3">
        <StatusBadge status={event.status} attempts={event.attempts} />
      </td>
      <td className="py-2.5 pr-3 text-xs tabular-nums text-muted-foreground">
        {lastSynced}
      </td>
      <td className="py-2.5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t("syncMap.rowActions")}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            {(event.status === "FAILED" || event.status === "SKIPPED") && (
              <DropdownMenuItem onSelect={onRetry} disabled={isPending}>
                <RotateCcw className="mr-2 size-3.5" />
                {t("actions.retry")}
              </DropdownMenuItem>
            )}
            {event.status !== "SENT" && event.status !== "SKIPPED" && (
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setSkipOpen(true);
                }}
              >
                <SkipForward className="mr-2 size-3.5" />
                {t("actions.skip")}
              </DropdownMenuItem>
            )}
            {canOpenInGoogle && (
              <>
                {(event.status === "FAILED" || event.status === "SKIPPED") && (
                  <DropdownMenuSeparator />
                )}
                <DropdownMenuItem
                  render={
                    <a
                      href={`https://calendar.google.com/calendar/u/0/r/eventedit/${event.googleEventId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="mr-2 size-3.5" />
                      {t("actions.openInGoogle")}
                    </a>
                  }
                />
              </>
            )}
            {event.status === "SENT" && !canOpenInGoogle && (
              <DropdownMenuItem disabled>
                <Clock className="mr-2 size-3.5" />
                {t("actions.noAction")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <SkipDialog
          eventId={event.id}
          open={skipOpen}
          onOpenChange={setSkipOpen}
          onDone={() => router.refresh()}
        />
      </td>
    </tr>
  );
}

function StatusBadge({
  status,
  attempts,
}: {
  status: CalendarSyncStatus;
  attempts: number;
}) {
  const t = useTranslations("calendarSync.statusBadge");
  const config = {
    SENT: { variant: "default" as const, label: t("sent") },
    PENDING: { variant: "secondary" as const, label: t("pending") },
    FAILED: { variant: "destructive" as const, label: t("failed") },
    SKIPPED: { variant: "outline" as const, label: t("skipped") },
  }[status];
  return (
    <div className="flex items-center gap-1.5">
      <Badge variant={config.variant} className="font-normal">
        {config.label}
      </Badge>
      {status === "FAILED" && attempts > 0 ? (
        <span className="text-xs text-muted-foreground">×{attempts}</span>
      ) : null}
    </div>
  );
}

function SkipDialog({
  eventId,
  open,
  onOpenChange,
  onDone,
}: {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const t = useTranslations("calendarSync");
  const [isPending, startTransition] = React.useTransition();
  const form = useForm<SkipEventInput>({
    resolver: zodResolver(skipEventSchema),
    defaultValues: { eventId, reason: "" },
  });

  React.useEffect(() => {
    if (!open) form.reset({ eventId, reason: "" });
  }, [open, eventId, form]);

  function onSubmit(values: SkipEventInput) {
    startTransition(async () => {
      const res = await skipCalendarEventAction(values);
      if (!res.ok) {
        toast.error(res.reason ?? t("toasts.skipFailed"));
        return;
      }
      toast.success(t("toasts.skipOk"));
      onOpenChange(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("skipDialog.title")}</DialogTitle>
          <DialogDescription>{t("skipDialog.description")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-3"
          >
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("skipDialog.reasonLabel")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder={t("skipDialog.reasonPlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <X className="mr-2 size-4" />
                )}
                {t("skipDialog.confirm")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
