"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
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
import {
  submitPmHandoverSchema,
  type SubmitPmHandoverInput,
} from "@/lib/validation/handover";

import { submitPmHandoverAction } from "./actions";

export type ProjectOption = {
  id: string;
  label: string;
  currentPmId: string | null;
  currentPmLabel: string;
};
export type PmOption = { id: string; label: string };

type FormValues = {
  project_id: string;
  from_pm_employee_id: string;
  to_pm_employee_id: string;
  effective_at: string;
  reason: string;
  handover_notes: string;
};

const DEFAULT_VALUES: FormValues = {
  project_id: "",
  from_pm_employee_id: "",
  to_pm_employee_id: "",
  effective_at: "",
  reason: "",
  handover_notes: "",
};

export function NewHandoverSheet({
  projects,
  pms,
}: {
  projects: ProjectOption[];
  pms: PmOption[];
}) {
  const t = useTranslations("handovers.form");
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const form = useForm<FormValues>({ defaultValues: DEFAULT_VALUES });

  const selectedProjectId = form.watch("project_id");
  React.useEffect(() => {
    const proj = projects.find((p) => p.id === selectedProjectId);
    if (proj?.currentPmId) {
      form.setValue("from_pm_employee_id", proj.currentPmId, {
        shouldValidate: false,
      });
    }
  }, [selectedProjectId, projects, form]);

  const canSubmit = projects.length > 0 && pms.length >= 2;

  async function onSubmit(values: FormValues) {
    const payload: SubmitPmHandoverInput = {
      project_id: values.project_id,
      from_pm_employee_id: values.from_pm_employee_id,
      to_pm_employee_id: values.to_pm_employee_id,
      effective_at: values.effective_at,
      reason: values.reason,
      handover_notes:
        values.handover_notes.trim() === "" ? undefined : values.handover_notes,
    };

    const parsed = submitPmHandoverSchema.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      if (first) {
        form.setError(first.path[0] as keyof FormValues, {
          message: first.message,
        });
      }
      return;
    }

    setSubmitting(true);
    const res = await submitPmHandoverAction(parsed.data);
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.reason);
      return;
    }
    toast.success(t("submitted"));
    form.reset(DEFAULT_VALUES);
    setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button disabled={!canSubmit}>
            <Plus className="size-4" /> {t("new")}
          </Button>
        }
      />
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>
            {canSubmit ? t("description") : t("needsPrereqs")}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-4 px-4 py-4"
          >
            <FormField
              control={form.control}
              name="project_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("project")}</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={!canSubmit}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("projectPlaceholder")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="from_pm_employee_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fromPm")}</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={!canSubmit}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("fromPmPlaceholder")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {pms.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="to_pm_employee_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("toPm")}</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={!canSubmit}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("toPmPlaceholder")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {pms.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="effective_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("effectiveAt")}</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("reason")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder={t("reasonPlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="handover_notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("notes")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={4}
                      placeholder={t("notesPlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <SheetFooter className="mt-auto flex-row justify-end gap-2 px-0">
              <SheetClose
                render={
                  <Button variant="ghost" type="button" disabled={submitting}>
                    {t("cancel")}
                  </Button>
                }
              />
              <Button type="submit" disabled={submitting || !canSubmit}>
                {submitting ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                {t("submit")}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
