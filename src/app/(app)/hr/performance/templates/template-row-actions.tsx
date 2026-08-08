"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Loader2,
  MoreHorizontal,
  Pencil,
  Power,
  PowerOff,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { QuestionType } from "@/lib/validation/evaluation";

import { toggleEvaluationTemplateActiveAction } from "../actions";
import { fetchTemplateForEdit } from "./lookup-actions";
import { NewTemplateSheet } from "./new-template-sheet";

type EditInitial = {
  id: string;
  name: string;
  description: string | null;
  items: Array<{
    seq: number;
    name: string;
    description: string;
    weight_pct: number;
    question_type: QuestionType;
    is_required: boolean;
  }>;
};

/**
 * Row-level menu for a template row. Items are fetched lazily when
 * the user opens Edit — the list page purposely doesn't join items
 * per row to keep the initial payload small.
 */
export function TemplateRowActions({
  templateId,
  isActive,
}: {
  templateId: string;
  isActive: boolean;
}) {
  const tCommon = useTranslations("common");
  const t = useTranslations("performance.templates.form");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editOpen, setEditOpen] = React.useState(false);
  const [initial, setInitial] = React.useState<EditInitial | null>(null);

  async function openEdit() {
    const res = await fetchTemplateForEdit({ id: templateId });
    if (!res.ok) {
      toast.error(res.reason ?? "Failed to load template.");
      return;
    }
    setInitial({
      id: res.data.id,
      name: res.data.name,
      description: res.data.description,
      items: res.data.items.map((it) => ({
        seq: it.seq,
        name: it.name,
        description: it.description ?? "",
        weight_pct: Number(it.weight_pct),
        question_type: it.question_type as QuestionType,
        is_required: it.is_required,
      })),
    });
    setEditOpen(true);
  }

  function onToggle() {
    startTransition(async () => {
      const res = await toggleEvaluationTemplateActiveAction({
        id: templateId,
        is_active: !isActive,
      });
      if (res.ok) {
        toast.success(isActive ? t("toggleInactive") : t("toggleActive"));
        router.refresh();
      } else {
        toast.error(res.reason ?? "Toggle failed.");
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size="icon" variant="ghost" aria-label="Row actions">
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={openEdit}>
            <Pencil className="size-4" />
            <span>{tCommon("edit")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggle} disabled={pending}>
            {isActive ? (
              <>
                <PowerOff className="size-4" />
                <span>{t("toggleInactive")}</span>
              </>
            ) : (
              <>
                <Power className="size-4" />
                <span>{t("toggleActive")}</span>
              </>
            )}
            {pending ? <Loader2 className="size-4 animate-spin ml-1" /> : null}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {initial ? (
        <NewTemplateSheet
          initial={initial}
          open={editOpen}
          onOpenChange={(next) => {
            setEditOpen(next);
            if (!next) setInitial(null);
          }}
        />
      ) : null}
    </>
  );
}
