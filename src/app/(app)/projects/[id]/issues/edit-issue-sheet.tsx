"use client";

/**
 * Edit an existing issue's mutable metadata (title, description,
 * severity, category, assignee, milestone, due date, tags, notes).
 *
 * Status transitions live in `transitionIssueAction` — this sheet is
 * for content edits only. Server enforcement:
 *   • Canonical PDP `decideProjectIssue('update')` — same role gate
 *     as create (SUPERVISOR/PM/OM/DIRECTOR/ADMIN).
 *   • Changing `severity` re-stamps `sla_due_at` per severity SLA.
 * We render this in row-level actions with a pencil icon — the parent
 * (`issues-section.tsx`) already gates by `canAct`, so passing that
 * boolean down is enough for UX. PDP re-authorizes on submit.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Save } from "lucide-react";
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
  ISSUE_CATEGORY_VALUES,
  ISSUE_SEVERITY_VALUES,
  updateIssueSchema,
  type UpdateIssueInput,
} from "@/lib/validation/issue";
import type {
  ProjectIssueCategory,
  ProjectIssueSeverity,
} from "@/types/database";

import { updateIssueAction } from "./actions";
import type {
  IssueAssigneeOption,
  IssueMilestoneOption,
} from "./new-issue-sheet";

const NONE_ASSIGNEE = "__none__";
const NONE_MILESTONE = "__none__";

export type EditIssueInitial = {
  id: string;
  title: string;
  description: string | null;
  severity: ProjectIssueSeverity;
  category: ProjectIssueCategory;
  assignee_employee_id: string | null;
  milestone_id: string | null;
  due_date: string | null;
  tags: string[] | null;
  notes: string | null;
};

type FormValues = {
  title: string;
  description: string;
  severity: ProjectIssueSeverity;
  category: ProjectIssueCategory;
  assignee_employee_id: string;
  milestone_id: string;
  due_date: string;
  tags: string;
  notes: string;
};

function toFormValues(v: EditIssueInitial): FormValues {
  return {
    title: v.title ?? "",
    description: v.description ?? "",
    severity: v.severity,
    category: v.category,
    assignee_employee_id: v.assignee_employee_id ?? NONE_ASSIGNEE,
    milestone_id: v.milestone_id ?? NONE_MILESTONE,
    due_date: v.due_date ?? "",
    tags: Array.isArray(v.tags) ? v.tags.join(", ") : "",
    notes: v.notes ?? "",
  };
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function EditIssueSheet({
  issue,
  employees,
  milestones,
}: {
  issue: EditIssueInitial;
  employees: IssueAssigneeOption[];
  milestones: IssueMilestoneOption[];
}) {
  const t = useTranslations("issues");
  const tf = useTranslations("issues.form");
  const tSev = useTranslations("issues.severity");
  const tCat = useTranslations("issues.category");
  const tCommon = useTranslations("common");

  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const defaults = React.useMemo(() => toFormValues(issue), [issue]);

  const form = useForm<FormValues>({
    defaultValues: defaults,
    resolver: async (values) => {
      const payload: Partial<UpdateIssueInput> = {
        issue_id: issue.id,
        title: values.title,
        description: values.description ?? "",
        severity: values.severity,
        category: values.category,
        assignee_employee_id:
          values.assignee_employee_id === NONE_ASSIGNEE
            ? null
            : values.assignee_employee_id || null,
        milestone_id:
          values.milestone_id === NONE_MILESTONE
            ? null
            : values.milestone_id || null,
        due_date: values.due_date ? values.due_date : null,
        tags: parseTags(values.tags),
        notes: values.notes || undefined,
      };
      const parsed = updateIssueSchema.safeParse(payload);
      if (parsed.success) return { values, errors: {} };
      const errs: Record<string, { type: string; message: string }> = {};
      for (const err of parsed.error.issues) {
        const key = String(err.path[err.path.length - 1] ?? "root");
        errs[key] = { type: "validate", message: err.message };
      }
      return { values: {}, errors: errs };
    },
  });

  React.useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults, open]);

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await updateIssueAction({
        issue_id: issue.id,
        title: values.title,
        description: values.description ?? "",
        severity: values.severity,
        category: values.category,
        assignee_employee_id:
          values.assignee_employee_id === NONE_ASSIGNEE
            ? null
            : values.assignee_employee_id || null,
        milestone_id:
          values.milestone_id === NONE_MILESTONE
            ? null
            : values.milestone_id || null,
        due_date: values.due_date ? values.due_date : null,
        tags: parseTags(values.tags),
        notes: values.notes || undefined,
      });
      if (result.ok) {
        toast.success(tf("updatedToast"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.reason);
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
          <Button size="sm" variant="ghost" aria-label={tCommon("edit")}>
            <Pencil className="size-4" />
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl md:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>{tf("editTitle")}</SheetTitle>
          <SheetDescription>{tf("editDescription")}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
          >
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("issueTitle")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={tf("issueTitlePlaceholder")}
                      autoFocus
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="severity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("priority")}</FormLabel>
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
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("category")}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) =>
                        field.onChange(v as ProjectIssueCategory)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ISSUE_CATEGORY_VALUES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {tCat(c)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="assignee_employee_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("assignee")}</FormLabel>
                    <Select
                      value={field.value || NONE_ASSIGNEE}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tf("assigneeUnassigned")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE_ASSIGNEE}>
                          {tf("assigneeUnassigned")}
                        </SelectItem>
                        {employees.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.label}
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
                name="milestone_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("milestone")}</FormLabel>
                    <Select
                      value={field.value || NONE_MILESTONE}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tf("milestoneNone")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE_MILESTONE}>
                          {tf("milestoneNone")}
                        </SelectItem>
                        {milestones.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="due_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("dueDate")}</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tags"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("tags")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={tf("tagsPlaceholder")}
                    />
                  </FormControl>
                  <p className="text-[10px] text-muted-foreground">
                    {tf("tagsHint")}
                  </p>
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
                    <Textarea
                      rows={4}
                      {...field}
                      placeholder={tf("descriptionPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("notes")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      {...field}
                      placeholder={tf("notesPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                {tf("submitEdit")}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
