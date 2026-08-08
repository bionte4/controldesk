"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText, Loader2, Send, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALLOWED_MIME_TYPES } from "@/lib/attachments/constants";

import {
  assignExpenseBudgetLineAction,
  deleteDraftExpenseAction,
  detachReceiptAction,
  submitDraftExpenseAction,
} from "./actions";
import { fetchBudgetLinesForProject } from "./lookup-actions";
import { uploadExpenseReceiptsAction } from "./upload-actions";

// ---------------------------------------------------------------------------
// Upload widget — pick multiple files, upload in one round trip.
// ---------------------------------------------------------------------------

export function UploadReceipts({
  expenseId,
  disabled,
}: {
  expenseId: string;
  disabled?: boolean;
}) {
  const t = useTranslations("expenses.detail");
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = React.useTransition();

  function onFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fd = new FormData();
    fd.set("expense_id", expenseId);
    for (const f of Array.from(files)) fd.append("files", f);
    startTransition(async () => {
      const res = await uploadExpenseReceiptsAction(fd);
      if (res.ok) {
        toast.success(t("uploadedToast", { n: res.data.uploaded }));
        router.refresh();
      } else {
        toast.error(res.reason);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_MIME_TYPES.join(",")}
        multiple
        className="sr-only"
        onChange={onFilesPicked}
        disabled={disabled || isPending}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isPending}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Upload className="size-4" />
        )}
        {t("uploadReceipts")}
      </Button>
      <p className="text-[11px] text-muted-foreground">{t("uploadHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attached receipts list — thumbnails for images, filename badge for PDFs.
// ---------------------------------------------------------------------------

export type ReceiptEntry = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  signed_url: string;
};

export function AttachedReceipts({
  expenseId,
  receipts,
  canDelete,
}: {
  expenseId: string;
  receipts: ReceiptEntry[];
  canDelete: boolean;
}) {
  const t = useTranslations("expenses.detail");
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const router = useRouter();

  function onDelete(id: string) {
    setPendingId(id);
    detachReceiptAction({ expense_id: expenseId, attachment_id: id })
      .then((res) => {
        if (res.ok) {
          toast.success(t("removedToast"));
          router.refresh();
        } else {
          toast.error(res.reason);
        }
      })
      .finally(() => setPendingId(null));
  }

  if (receipts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("receiptsEmpty")}</p>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {receipts.map((r) => {
        const isImage = r.mime_type.startsWith("image/");
        return (
          <li
            key={r.id}
            className="group relative overflow-hidden rounded-lg border border-border/50 bg-muted/20"
          >
            <div className="relative aspect-video bg-muted/40">
              {isImage && r.signed_url ? (
                <Image
                  src={r.signed_url}
                  alt={r.filename}
                  fill
                  sizes="(max-width: 640px) 100vw, 33vw"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <FileText className="size-10 text-muted-foreground" />
                </div>
              )}
              {canDelete ? (
                <button
                  type="button"
                  onClick={() => onDelete(r.id)}
                  disabled={pendingId === r.id}
                  aria-label={t("removeReceipt")}
                  className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
                >
                  {pendingId === r.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <X className="size-3.5" />
                  )}
                </button>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <a
                href={r.signed_url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-xs hover:text-primary"
              >
                {r.filename}
              </a>
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {(r.size_bytes / 1024).toFixed(0)} KB
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Submit-for-approval button — DRAFT → PENDING_L1_SUPERVISOR.
// ---------------------------------------------------------------------------

export function SubmitDraftButton({
  expenseId,
  disabled,
  lockedReason,
}: {
  expenseId: string;
  disabled: boolean;
  lockedReason?: string;
}) {
  const t = useTranslations("expenses.detail");
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  function onSubmit() {
    startTransition(async () => {
      const res = await submitDraftExpenseAction({ id: expenseId });
      if (res.ok) {
        toast.success("Expense submitted for approval.");
        router.refresh();
      } else {
        toast.error(res.reason);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={onSubmit} disabled={disabled || isPending}>
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
        {t("submitForApproval")}
      </Button>
      {disabled && lockedReason ? (
        <p className="max-w-xs text-right text-[11px] text-muted-foreground">
          {lockedReason}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assign budget line (MA) — approver-side classifier.
//
// Field submitters (Employee/Supervisor) file expenses without picking an
// MA line; PM / Finance / OM+ classify the row during review. The widget
// only renders in the detail page when the caller is a `TRUSTED_MA_EDITOR`
// per PDP §9 and the expense is non-terminal.
// ---------------------------------------------------------------------------

export function AssignBudgetLine({
  expenseId,
  projectId,
  currentBudgetDetailId,
  currentLabel,
}: {
  expenseId: string;
  projectId: string;
  currentBudgetDetailId: string | null;
  currentLabel: string | null;
}) {
  const t = useTranslations("expenses.detail");
  const router = useRouter();
  const [lines, setLines] = React.useState<
    { id: string; label: string; remaining_amount: number }[]
  >([]);
  const [loading, setLoading] = React.useState(false);
  const [selection, setSelection] = React.useState<string>(
    currentBudgetDetailId ?? "",
  );
  const [editing, setEditing] = React.useState<boolean>(!currentBudgetDetailId);
  const [isPending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    setLoading(true);
    fetchBudgetLinesForProject({ project_id: projectId })
      .then((res) => {
        if (cancelled) return;
        setLines(
          res.ok
            ? res.data.map((l) => ({
                id: l.id,
                label: l.label,
                remaining_amount: l.remaining_amount,
              }))
            : [],
        );
      })
      .catch(() => {
        if (!cancelled) setLines([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, editing]);

  function onSave() {
    if (!selection) return;
    startTransition(async () => {
      const res = await assignExpenseBudgetLineAction({
        id: expenseId,
        budget_detail_id: selection,
      });
      if (res.ok) {
        toast.success(t("budgetLineAssignedToast"));
        setEditing(false);
        router.refresh();
      } else {
        toast.error(res.reason);
      }
    });
  }

  const labelFor = (id: string): string =>
    lines.find((l) => l.id === id)?.label ?? id;

  if (!editing && currentBudgetDetailId) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("budgetLineLabel")}
          </p>
          <p className="truncate text-sm font-medium">
            {currentLabel ?? currentBudgetDetailId}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setEditing(true)}
        >
          {t("changeBudgetLine")}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-3">
      <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        {currentBudgetDetailId
          ? t("changeBudgetLine")
          : t("assignBudgetLineTitle")}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={selection}
          onValueChange={(v) => setSelection(v ?? "")}
          disabled={loading || isPending || lines.length === 0}
        >
          <SelectTrigger className="w-full min-w-0 sm:min-w-[280px]">
            <SelectValue
              placeholder={
                loading
                  ? t("loadingBudgetLines")
                  : lines.length === 0
                    ? t("noBudgetLines")
                    : t("selectBudgetLine")
              }
            >
              {(value) =>
                value ? labelFor(value as string) : t("selectBudgetLine")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {lines.map((line) => (
              <SelectItem key={line.id} value={line.id}>
                {line.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={!selection || isPending}
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("saveBudgetLine")}
          </Button>
          {currentBudgetDetailId ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelection(currentBudgetDetailId);
                setEditing(false);
              }}
              disabled={isPending}
            >
              {t("cancelBudgetLine")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete-draft button — confirmation dialog.
// ---------------------------------------------------------------------------

export function DeleteDraftButton({ expenseId }: { expenseId: string }) {
  const t = useTranslations("expenses.detail");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  function onConfirm() {
    startTransition(async () => {
      const res = await deleteDraftExpenseAction({ id: expenseId });
      if (res.ok) {
        toast.success(t("deletedToast"));
        setOpen(false);
        router.push("/finance/expenses");
      } else {
        toast.error(res.reason);
        setOpen(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="ghost"
        className="text-rose-500 hover:text-rose-400"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
        {t("deleteDraft")}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("confirmDelete")}</DialogTitle>
          <DialogDescription>{t("confirmDeleteBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {t("deleteDraft")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
