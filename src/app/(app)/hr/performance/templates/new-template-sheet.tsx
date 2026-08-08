"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { QuestionType } from "@/lib/validation/evaluation";

import {
  createEvaluationTemplateAction,
  updateEvaluationTemplateAction,
} from "../actions";

type ItemDraft = {
  seq: number;
  name: string;
  description: string;
  weight_pct: number;
  question_type: QuestionType;
  is_required: boolean;
};

const DEFAULT_ITEMS: ItemDraft[] = [
  {
    seq: 1,
    name: "",
    description: "",
    weight_pct: 100,
    question_type: "SCORE_1_5",
    is_required: true,
  },
];

/**
 * Create / edit an evaluation template. When `initial` is supplied
 * we behave as an editor and call the update action; otherwise we
 * open the "New template" flow.
 */
export function NewTemplateSheet({
  initial,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  initial?: {
    id: string;
    name: string;
    description: string | null;
    items: ItemDraft[];
  };
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const tRoot = useTranslations("performance");
  const t = useTranslations("performance.templates.form");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const isEdit = Boolean(initial);

  const [uncontrolled, setUncontrolled] = React.useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolled;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (isControlled) {
        onOpenChange?.(next);
      } else {
        setUncontrolled(next);
      }
    },
    [isControlled, onOpenChange],
  );
  const [name, setName] = React.useState(initial?.name ?? "");
  const [description, setDescription] = React.useState(
    initial?.description ?? "",
  );
  const [items, setItems] = React.useState<ItemDraft[]>(
    initial?.items ?? DEFAULT_ITEMS,
  );
  const [pending, startTransition] = React.useTransition();

  // Reset on open/close cycle so a fresh create starts empty even if
  // the sheet was previously opened for an edit in the same session.
  React.useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setDescription(initial.description ?? "");
      setItems(initial.items.length > 0 ? initial.items : DEFAULT_ITEMS);
    } else {
      setName("");
      setDescription("");
      setItems(DEFAULT_ITEMS);
    }
  }, [open, initial]);

  const totalWeight = items.reduce((s, it) => s + (Number(it.weight_pct) || 0), 0);

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        seq: prev.length > 0 ? Math.max(...prev.map((p) => p.seq)) + 1 : 1,
        name: "",
        description: "",
        weight_pct: 0,
        question_type: "SCORE_1_5",
        is_required: true,
      },
    ]);
  }

  function removeItem(seq: number) {
    setItems((prev) => prev.filter((it) => it.seq !== seq));
  }

  function patchItem(seq: number, patch: Partial<ItemDraft>) {
    setItems((prev) =>
      prev.map((it) => (it.seq === seq ? { ...it, ...patch } : it)),
    );
  }

  function onSubmit() {
    if (!name.trim()) {
      toast.error(t("name"));
      return;
    }
    if (items.length === 0) {
      toast.error("Add at least one item.");
      return;
    }
    // Server-side validation catches details but we bail early on
    // clearly-blank names to save a round-trip.
    for (const it of items) {
      if (!it.name.trim()) {
        toast.error("Every item needs a name.");
        return;
      }
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      items: items.map((it, idx) => ({
        seq: idx + 1,
        name: it.name.trim(),
        description: it.description.trim() || undefined,
        weight_pct: Number(it.weight_pct) || 0,
        question_type: it.question_type,
        is_required: it.is_required,
      })),
    };

    startTransition(async () => {
      const res = isEdit
        ? await updateEvaluationTemplateAction({ id: initial!.id, ...payload })
        : await createEvaluationTemplateAction(payload);
      if (res.ok) {
        toast.success(isEdit ? t("updateSuccess") : t("createSuccess"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.reason ?? "Failed to save template.");
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {isControlled ? null : (
        <SheetTrigger
          render={
            trigger ?? (
              <Button>
                <Plus className="size-4" />
                {tRoot("templates.newTemplate")}
              </Button>
            )
          }
        />
      )}
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {isEdit
              ? tRoot("templates.editTemplate")
              : tRoot("templates.newTemplate")}
          </SheetTitle>
          <SheetDescription>{tRoot("templates.subtitle")}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 py-3">
          {/* Header fields */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">{t("name")}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              maxLength={160}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">{t("description")}</label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("descriptionPlaceholder")}
              maxLength={2000}
            />
          </div>

          {/* Items */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{t("items")}</div>
                <p className="text-[11px] text-muted-foreground">
                  {t("itemsHint")}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={addItem}>
                <Plus className="size-4" />
                {t("addItem")}
              </Button>
            </div>

            <div className="rounded-lg border">
              <div className="grid grid-cols-[minmax(0,1fr)_80px_120px_80px_40px] gap-2 px-3 py-2 text-[11px] font-medium text-muted-foreground border-b bg-muted/30">
                <span>{t("itemName")}</span>
                <span className="text-right">{t("itemWeight")}</span>
                <span>{t("itemType")}</span>
                <span className="text-center">{t("itemRequired")}</span>
                <span />
              </div>
              <div className="divide-y">
                {items.map((it) => (
                  <div
                    key={it.seq}
                    className="grid grid-cols-[minmax(0,1fr)_80px_120px_80px_40px] gap-2 px-3 py-2 items-start"
                  >
                    <div className="grid gap-1">
                      <Input
                        value={it.name}
                        onChange={(e) =>
                          patchItem(it.seq, { name: e.target.value })
                        }
                        placeholder={t("itemNamePlaceholder")}
                        maxLength={240}
                      />
                      <Textarea
                        rows={1}
                        value={it.description}
                        onChange={(e) =>
                          patchItem(it.seq, { description: e.target.value })
                        }
                        placeholder={t("itemDescriptionPlaceholder")}
                        maxLength={1000}
                      />
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={it.weight_pct}
                      onChange={(e) =>
                        patchItem(it.seq, {
                          weight_pct: Number(e.target.value),
                        })
                      }
                      className="text-right tabular-nums"
                    />
                    <Select
                      value={it.question_type}
                      onValueChange={(v) =>
                        patchItem(it.seq, {
                          question_type: (v as QuestionType) ?? "SCORE_1_5",
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SCORE_1_5">
                          {t("itemTypeScore")}
                        </SelectItem>
                        <SelectItem value="TEXT">{t("itemTypeText")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="grid place-items-center pt-2">
                      <Checkbox
                        checked={it.is_required}
                        onCheckedChange={(v) =>
                          patchItem(it.seq, { is_required: Boolean(v) })
                        }
                      />
                    </div>
                    <div className="grid place-items-center">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeItem(it.seq)}
                        disabled={items.length <= 1}
                        aria-label={t("removeItem")}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-xs flex justify-end gap-2 pr-1">
              <span className="text-muted-foreground">{t("totalWeight")}:</span>
              <span
                className={
                  totalWeight === 100
                    ? "font-medium text-emerald-500"
                    : "font-medium text-amber-500"
                }
              >
                {totalWeight.toFixed(1)}%
              </span>
            </div>
            {totalWeight !== 100 ? (
              <p className="text-[11px] text-amber-600">
                {t("weightWarning", { total: totalWeight.toFixed(1) })}
              </p>
            ) : null}
          </div>
        </div>

        <SheetFooter className="flex-row justify-end gap-2">
          <SheetClose
            render={
              <Button variant="ghost" disabled={pending}>
                {tCommon("cancel")}
              </Button>
            }
          />
          <Button onClick={onSubmit} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {tCommon("save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
