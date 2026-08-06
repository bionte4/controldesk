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
  ISSUE_SEVERITY_VALUES,
  createIssueSchema,
} from "@/lib/validation/issue";
import type { ProjectIssueSeverity } from "@/types/database";

import { createIssueAction } from "./actions";

export type IssueAssigneeOption = { id: string; label: string };

type FormValues = {
  title: string;
  description: string;
  severity: ProjectIssueSeverity;
  assignee_employee_id: string;
};

export function NewIssueSheet({
  projectId,
  employees,
}: {
  projectId: string;
  employees: IssueAssigneeOption[];
}) {
  const t = useTranslations("issues");
  const tf = useTranslations("issues.form");
  const tSev = useTranslations("issues.severity");
  const tCommon = useTranslations("common");

  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<FormValues, unknown, FormValues>({
    defaultValues: {
      title: "",
      description: "",
      severity: "MEDIUM",
      assignee_employee_id: "",
    },
    resolver: async (values) => {
      const parsed = createIssueSchema.safeParse({
        project_id: projectId,
        title: values.title,
        description: values.description,
        severity: values.severity,
        assignee_employee_id: values.assignee_employee_id || undefined,
      });
      if (parsed.success) return { values, errors: {} };
      const errs: Record<string, { type: string; message: string }> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[issue.path.length - 1] ?? "root");
        errs[key] = { type: "validate", message: issue.message };
      }
      return { values: {}, errors: errs };
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await createIssueAction({
        project_id: projectId,
        title: values.title,
        description: values.description,
        severity: values.severity,
        assignee_employee_id: values.assignee_employee_id || undefined,
      });
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success(tf("createdToast"));
      form.reset({
        title: "",
        description: "",
        severity: "MEDIUM",
        assignee_employee_id: "",
      });
      setOpen(false);
    });
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button size="sm" variant="outline">
            <Plus className="size-4" />
            {t("new")}
          </Button>
        }
      />
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{tf("title")}</SheetTitle>
          <SheetDescription>{tf("description")}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("issueTitle")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={tf("issueTitlePlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="severity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("severity")}</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) =>
                      field.onChange(v as ProjectIssueSeverity)
                    }
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ISSUE_SEVERITY_VALUES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {tSev(s)}
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
              name="assignee_employee_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("assignee")}</FormLabel>
                  <Select
                    value={field.value || undefined}
                    onValueChange={(v) => field.onChange(v)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={tf("assigneeUnassigned")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {employees.map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.label}
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
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("descriptionField")}</FormLabel>
                  <FormControl>
                    <Textarea rows={5} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SheetFooter className="mt-2 flex-row justify-end gap-2">
              <SheetClose
                render={
                  <Button type="button" variant="ghost" disabled={isPending}>
                    {tCommon("cancel")}
                  </Button>
                }
              />
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {tCommon("loading")}
                  </>
                ) : null}
                {tf("submit")}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
