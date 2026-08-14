"use client";

/**
 * Edit the project Business Case fields (executive summary, target GM %,
 * sponsor). Separate sheet from `EditProjectSheet` because BC editing
 * has stricter status gating:
 *   • Server enforces `["DRAFT","PLANNING"].includes(status)` in
 *     `updateProjectBusinessCaseAction` (actions.ts:397).
 *   • PDP `decideProject('update')` — OM / HM / GM / TENANT_ADMIN.
 *
 * Rendered only when the project is DRAFT/PLANNING and the caller has
 * `canEditProject` — surface just once, not on ACTIVE/COMPLETED where
 * the BC is treated as immutable audit context.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { FileText, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

import { updateProjectBusinessCaseAction } from "../actions";

export type BcSponsorOption = { id: string; label: string };

export type EditBusinessCaseInitial = {
  id: string;
  bc_executive_summary: string | null;
  bc_target_gm_pct: number | string | null;
  bc_sponsor_id: string | null;
};

const NO_SPONSOR = "__none__";

type FormValues = {
  bc_executive_summary: string;
  bc_target_gm_pct: string;
  bc_sponsor_id: string;
};

function toFormValues(v: EditBusinessCaseInitial): FormValues {
  return {
    bc_executive_summary: v.bc_executive_summary ?? "",
    bc_target_gm_pct:
      v.bc_target_gm_pct !== null && v.bc_target_gm_pct !== undefined
        ? String(v.bc_target_gm_pct)
        : "",
    bc_sponsor_id: v.bc_sponsor_id ?? NO_SPONSOR,
  };
}

export function EditBusinessCaseSheet({
  project,
  sponsors,
}: {
  project: EditBusinessCaseInitial;
  sponsors: BcSponsorOption[];
}) {
  const t = useTranslations("projects.businessCase");
  const tCommon = useTranslations("common");

  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const defaults = React.useMemo(() => toFormValues(project), [project]);
  const form = useForm<FormValues>({ defaultValues: defaults });

  React.useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults, open]);

  function onSubmit(values: FormValues) {
    let targetGm: number | undefined;
    if (values.bc_target_gm_pct.trim()) {
      const parsed = Number(values.bc_target_gm_pct.trim().replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        form.setError("bc_target_gm_pct", { message: t("targetGmHint") });
        return;
      }
      targetGm = parsed;
    }
    startTransition(async () => {
      const res = await updateProjectBusinessCaseAction({
        id: project.id,
        bc_executive_summary: values.bc_executive_summary.trim() || undefined,
        bc_target_gm_pct: targetGm,
        bc_sponsor_id:
          values.bc_sponsor_id && values.bc_sponsor_id !== NO_SPONSOR
            ? values.bc_sponsor_id
            : undefined,
      });
      if (res.ok) {
        toast.success(t("updatedToast"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.reason);
      }
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset(defaults);
      }}
    >
      <SheetTrigger
        render={
          <Button size="sm" variant="outline">
            <FileText className="size-4" />
            {t("editButton")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl"
      >
        <SheetHeader>
          <SheetTitle>{t("editTitle")}</SheetTitle>
          <SheetDescription>{t("editDescription")}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
          >
            <FormField
              control={form.control}
              name="bc_executive_summary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("summaryLabel")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={6}
                      {...field}
                      placeholder={t("summaryPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormField
                control={form.control}
                name="bc_target_gm_pct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("targetGmLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode="decimal"
                        placeholder="25.00"
                      />
                    </FormControl>
                    <p className="text-[10px] text-muted-foreground">
                      {t("targetGmHint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="bc_sponsor_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("sponsorLabel")}</FormLabel>
                    <Select
                      value={field.value || NO_SPONSOR}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("sponsorPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_SPONSOR}>
                          {t("sponsorNone")}
                        </SelectItem>
                        {sponsors.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <SheetFooter className="mt-auto flex-row justify-end gap-2 px-0">
              <SheetClose
                render={
                  <Button variant="ghost" type="button" disabled={isPending}>
                    {tCommon("cancel")}
                  </Button>
                }
              />
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Save className="mr-2 size-4" />
                )}
                {t("submitEdit")}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
