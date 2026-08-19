"use client";

/**
 * Project meta editor (RBAC: OM+ / TENANT_ADMIN — enforced by
 * `decideProject('update')` in `src/lib/security/pdp.ts`).
 *
 * Scope:
 *   • Only fields safe to change post-creation: name, description,
 *     priority, project_type, location, timeline, contract value,
 *     currency, notes, sync_calendar toggle.
 *   • NOT editable here (each has its own action / UI):
 *     - `status` — lifecycle transitions (Business Case → Planning →
 *       Active) via `promoteProjectFromBusinessCaseAction` /
 *       `activateProjectAction`.
 *     - `client_id` — reassigning a client requires creating a new
 *       project (financial ledger integrity, rules §8).
 *     - `pm_employee_id` — managed via `createPmAssignmentAction`
 *       (rules §7 assignment engine).
 *     - Business Case fields (bc_*) — managed via
 *       `updateProjectBusinessCaseAction` (needs OM+ AND separate
 *       audit trail).
 *
 * The server action `updateProjectAction` is a `withSecureAction`
 * mutation (rules §17). This client sheet is a thin form — validation
 * happens both in the browser (RHF + Zod) and on the server (PDP + Zod
 * re-parse); the trust boundary sits at the action, not here.
 */

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormDescription,
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
  PROJECT_PRIORITIES,
  PROJECT_TYPES,
  updateProjectSchema,
  type UpdateProjectInput,
} from "@/lib/validation/project";

import { updateProjectAction } from "../actions";

export type EditProjectSheetProject = {
  id: string;
  name: string;
  description: string | null;
  priority: string;
  project_type: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  contract_value: string | number | null;
  currency: string | null;
  notes: string | null;
  sync_calendar: boolean | null;
};

/**
 * Server-side numeric columns arrive as strings (Supabase numeric
 * round-trip). Convert to a whole-rupiah integer safely; null/empty
 * → undefined so the Zod schema keeps the field optional.
 */
function contractValueToRupiah(v: string | number | null): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return Math.round(v);
  const parsed = Number.parseFloat(v);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed);
}

export function EditProjectSheet({ project }: { project: EditProjectSheetProject }) {
  const t = useTranslations("projects");
  const tf = useTranslations("projects.form");
  const tPriority = useTranslations("projects.priority");
  const tType = useTranslations("projects.type");
  const tw = useTranslations("projects.wizard");
  const tCommon = useTranslations("common");

  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const defaultValues: UpdateProjectInput = React.useMemo(
    () => ({
      id: project.id,
      name: project.name,
      description: project.description ?? undefined,
      priority: (project.priority ??
        "MEDIUM") as UpdateProjectInput["priority"],
      project_type: project.project_type as UpdateProjectInput["project_type"],
      location: project.location ?? undefined,
      start_date: project.start_date ?? undefined,
      end_date: project.end_date ?? undefined,
      contract_value_idr: contractValueToRupiah(project.contract_value),
      currency: project.currency ?? "IDR",
      notes: project.notes ?? undefined,
      sync_calendar: project.sync_calendar ?? true,
    }),
    [project],
  );

  const form = useForm<UpdateProjectInput>({
    resolver: zodResolver(updateProjectSchema) as unknown as Resolver<UpdateProjectInput>,
    defaultValues,
    mode: "onBlur",
  });

  // Rehydrate the form whenever the underlying project row changes (e.g.
  // parent revalidated after an approval flow). Without this, opening the
  // sheet twice on the same page load would show stale values.
  React.useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  function onSubmit(values: UpdateProjectInput) {
    startTransition(async () => {
      const result = await updateProjectAction(values);
      if (result.ok) {
        toast.success(tf("updated", { name: result.data.name }));
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
        if (!next) form.reset(defaultValues);
      }}
    >
      <SheetTrigger
        render={
          <Button size="sm" variant="outline" aria-label={tCommon("edit")}>
            <Pencil className="size-4" />
            {tCommon("edit")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle>{tf("editTitle")}</SheetTitle>
          <SheetDescription>{tf("editDescription")}</SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            {/* Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("name")}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Row: priority + project type */}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("priority")}</FormLabel>
                    <Select
                      value={field.value ?? "MEDIUM"}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PROJECT_PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {tPriority(p)}
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
                name="project_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("projectType")}</FormLabel>
                    <Select
                      value={field.value ?? undefined}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tf("projectTypePlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PROJECT_TYPES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {tType(p)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Location */}
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("location")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      placeholder={tf("locationPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Row: start / end date */}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="start_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("startDate")}</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value || undefined)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="end_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("endDate")}</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value || undefined)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Row: contract value + currency */}
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <FormField
                control={form.control}
                name="contract_value_idr"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tw("contractValue")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") {
                            field.onChange(undefined);
                            return;
                          }
                          const n = Number.parseInt(raw, 10);
                          field.onChange(Number.isFinite(n) ? n : undefined);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tw("currency")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? "IDR"}
                        maxLength={3}
                        aria-label={tw("currency")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("description")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ""}
                      rows={3}
                      placeholder={tf("descriptionPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tw("notes")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ""}
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Calendar sync toggle */}
            <FormField
              control={form.control}
              name="sync_calendar"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm">
                      {tw("syncCalendar")}
                    </FormLabel>
                    <FormDescription className="text-xs">
                      {tw("syncCalendarHint")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={!!field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <SheetFooter className="mt-2 flex flex-row justify-end gap-2">
              <SheetClose
                render={
                  <Button type="button" variant="ghost" disabled={isPending}>
                    {tCommon("cancel")}
                  </Button>
                }
              />
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
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
