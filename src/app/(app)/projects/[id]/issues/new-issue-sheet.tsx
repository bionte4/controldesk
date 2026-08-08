"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Paperclip, Plus, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ISSUE_CATEGORY_VALUES,
  ISSUE_SEVERITY_VALUES,
  createIssueSchema,
} from "@/lib/validation/issue";
import { ALLOWED_MIME_TYPES } from "@/lib/attachments/constants";
import type {
  ProjectIssueCategory,
  ProjectIssueSeverity,
} from "@/types/database";

import { createIssueAction } from "./actions";
import { uploadIssueAttachmentsAction } from "./upload-actions";

export type IssueAssigneeOption = { id: string; label: string };
export type IssueMilestoneOption = { id: string; label: string };

const NONE_MILESTONE = "__none__";

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

export function NewIssueSheet({
  projectId,
  projectLabel,
  employees,
  milestones,
  defaultSeverity = "MEDIUM",
}: {
  projectId: string;
  /**
   * Read-only label of the project this sheet is scoped to, rendered as a
   * chip (matches the ORM-style mockup — the project is locked because the
   * sheet is opened from within the project detail page).
   */
  projectLabel?: string;
  employees: IssueAssigneeOption[];
  milestones: IssueMilestoneOption[];
  /**
   * Seed severity value inherited from the parent project's `priority`
   * column (rules §7). Feeds the default of the "Priority" select so a
   * Critical project defaults new issues to a 1h SLA instead of MEDIUM.
   */
  defaultSeverity?: ProjectIssueSeverity;
}) {
  const t = useTranslations("issues");
  const tf = useTranslations("issues.form");
  const tSev = useTranslations("issues.severity");
  const tCat = useTranslations("issues.category");
  const tCommon = useTranslations("common");

  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [stagedFiles, setStagedFiles] = React.useState<File[]>([]);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const form = useForm<FormValues, unknown, FormValues>({
    defaultValues: {
      title: "",
      description: "",
      severity: defaultSeverity,
      category: "BUG",
      assignee_employee_id: "",
      milestone_id: "",
      due_date: "",
      tags: "",
      notes: "",
    },
    resolver: async (values) => {
      const parsed = createIssueSchema.safeParse({
        project_id: projectId,
        title: values.title,
        description: values.description,
        severity: values.severity,
        category: values.category,
        assignee_employee_id: values.assignee_employee_id || undefined,
        milestone_id:
          values.milestone_id && values.milestone_id !== NONE_MILESTONE
            ? values.milestone_id
            : undefined,
        due_date: values.due_date || undefined,
        tags: parseTags(values.tags),
        notes: values.notes || undefined,
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

  function parseTags(raw: string): string[] {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function onFilesPicked(picked: FileList | null) {
    setUploadError(null);
    if (!picked) return;
    const next: File[] = [...stagedFiles];
    for (const f of Array.from(picked)) {
      if (!ALLOWED_MIME_TYPES.includes(f.type as never)) {
        setUploadError(tf("attachments.unsupportedType", { name: f.name }));
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        setUploadError(tf("attachments.tooLarge", { name: f.name }));
        continue;
      }
      next.push(f);
    }
    setStagedFiles(next);
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeStagedFile(idx: number) {
    setStagedFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function resetSheet() {
    form.reset({
      title: "",
      description: "",
      severity: defaultSeverity,
      category: "BUG",
      assignee_employee_id: "",
      milestone_id: "",
      due_date: "",
      tags: "",
      notes: "",
    });
    setStagedFiles([]);
    setUploadError(null);
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await createIssueAction({
        project_id: projectId,
        title: values.title,
        description: values.description,
        severity: values.severity,
        category: values.category,
        assignee_employee_id: values.assignee_employee_id || undefined,
        milestone_id:
          values.milestone_id && values.milestone_id !== NONE_MILESTONE
            ? values.milestone_id
            : undefined,
        due_date: values.due_date || undefined,
        tags: parseTags(values.tags),
        notes: values.notes || undefined,
      });
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      // Upload attachments (best-effort) — the issue itself is already saved,
      // so a partial failure is surfaced as a toast but does not roll back.
      if (stagedFiles.length > 0) {
        const fd = new FormData();
        fd.set("issue_id", result.data.id);
        for (const f of stagedFiles) fd.append("files", f);
        const up = await uploadIssueAttachmentsAction(fd);
        if (!up.ok) {
          toast.warning(tf("attachments.partialUploadFailed"), {
            description: up.reason,
          });
        }
      }
      toast.success(tf("createdToast"));
      resetSheet();
      setOpen(false);
    });
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetSheet();
      }}
    >
      <SheetTrigger
        render={
          <Button size="sm" variant="outline">
            <Plus className="size-4" />
            {t("new")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl md:max-w-3xl lg:max-w-4xl"
      >
        <SheetHeader>
          <SheetTitle>{tf("title")}</SheetTitle>
          <SheetDescription>{tf("description")}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            onSubmit={onSubmit}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
          >
            {/* Row 1: Project chip + Milestone. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormItem className="min-w-0">
                <FormLabel>{tf("project")}</FormLabel>
                <div
                  data-slot="locked-project"
                  className="flex h-9 w-full min-w-0 items-center overflow-hidden rounded-md border border-input bg-muted/40 px-3 text-sm"
                  aria-readonly="true"
                  title={projectLabel ?? undefined}
                >
                  <span className="block w-full min-w-0 truncate">
                    {projectLabel ?? tf("projectLockedFallback")}
                  </span>
                </div>
              </FormItem>

              <FormField
                control={form.control}
                name="milestone_id"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{tf("milestone")}</FormLabel>
                    <Select
                      value={field.value || NONE_MILESTONE}
                      onValueChange={(v) =>
                        field.onChange(v === NONE_MILESTONE ? "" : v)
                      }
                    >
                      <FormControl>
                        <SelectTrigger className="w-full min-w-0">
                          <SelectValue>
                            {(value: unknown) => {
                              if (!value || value === NONE_MILESTONE) {
                                return (
                                  <span className="block min-w-0 flex-1 truncate text-left text-muted-foreground">
                                    {tf("milestoneNone")}
                                  </span>
                                );
                              }
                              const opt = milestones.find(
                                (m) => m.id === value,
                              );
                              return (
                                <span className="block min-w-0 flex-1 truncate text-left">
                                  {opt?.label ?? tf("milestoneNone")}
                                </span>
                              );
                            }}
                          </SelectValue>
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
                    <p className="text-xs text-muted-foreground">
                      {tf("milestoneHint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Row 2: Title full width. */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {tf("issueTitle")}{" "}
                    <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={tf("issueTitlePlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Row 3: Category | Priority (=severity). */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>
                      {tf("category")}{" "}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) =>
                        field.onChange(v as ProjectIssueCategory)
                      }
                    >
                      <FormControl>
                        <SelectTrigger className="w-full min-w-0">
                          <SelectValue>
                            {(value: unknown) =>
                              value ? (
                                <span className="block min-w-0 flex-1 truncate text-left">
                                  {tCat(value as ProjectIssueCategory)}
                                </span>
                              ) : null
                            }
                          </SelectValue>
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

              <FormField
                control={form.control}
                name="severity"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>
                      {tf("priority")}{" "}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) =>
                        field.onChange(v as ProjectIssueSeverity)
                      }
                    >
                      <FormControl>
                        <SelectTrigger className="w-full min-w-0">
                          <SelectValue>
                            {(value: unknown) =>
                              value ? (
                                <span className="block min-w-0 flex-1 truncate text-left">
                                  {tSev(value as ProjectIssueSeverity)}
                                </span>
                              ) : null
                            }
                          </SelectValue>
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
                    <p className="text-xs text-muted-foreground">
                      {tf("priorityHint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Row 4: Due date | Assign to. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="due_date"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{tf("dueDate")}</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={field.onBlur}
                        name={field.name}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="assignee_employee_id"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{tf("assignee")}</FormLabel>
                    <Select
                      value={field.value || undefined}
                      onValueChange={(v) => field.onChange(v)}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full min-w-0">
                          <SelectValue placeholder={tf("assigneeUnassigned")}>
                            {(value: unknown) => {
                              if (!value) return tf("assigneeUnassigned");
                              const opt = employees.find(
                                (e) => e.id === value,
                              );
                              return (
                                <span className="block min-w-0 flex-1 truncate text-left">
                                  {opt?.label ?? tf("assigneeUnassigned")}
                                </span>
                              );
                            }}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent alignItemWithTrigger={false}>
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
            </div>

            {/* Row 5: Description. */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("descriptionField")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={5}
                      placeholder={tf("descriptionPlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Row 6: Tags | Notes. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{tf("tags")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={tf("tagsPlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      {tf("tagsHint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{tf("notes")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={tf("notesPlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      {tf("notesHint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Row 7: Attachments — file staging. */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  {tf("attachments.label")}
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => inputRef.current?.click()}
                  disabled={isPending}
                >
                  <Paperclip className="size-4" />
                  {tf("attachments.add")}
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept={ALLOWED_MIME_TYPES.join(",")}
                  className="hidden"
                  onChange={(e) => onFilesPicked(e.target.files)}
                  aria-label={tf("attachments.pickerLabel")}
                />
              </div>
              {uploadError ? (
                <p className="text-xs text-destructive">{uploadError}</p>
              ) : null}
              {stagedFiles.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {tf("attachments.hint")}
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {stagedFiles.map((f, idx) => (
                    <li key={`${f.name}-${idx}`}>
                      <Badge
                        variant="outline"
                        className={cn(
                          "flex items-center gap-1 max-w-[220px]",
                          "border-border/60 bg-muted/40",
                        )}
                      >
                        <Paperclip className="size-3 shrink-0" />
                        <span className="truncate">{f.name}</span>
                        <button
                          type="button"
                          onClick={() => removeStagedFile(idx)}
                          aria-label={tf("attachments.removeAria")}
                          className="ml-1 text-muted-foreground hover:text-foreground"
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <SheetFooter className="mt-2 flex-row justify-end gap-2 px-0">
              <SheetClose
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isPending}
                  >
                    {tCommon("cancel")}
                  </Button>
                }
              />
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
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
