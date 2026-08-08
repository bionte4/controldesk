"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { AdminLookupOption, LookupDomain } from "@/lib/data/lookups";

import {
  createLookupOptionAction,
  deleteLookupOptionAction,
  toggleLookupOptionActiveAction,
  updateLookupOptionAction,
} from "./actions";

type DomainBucket = Record<LookupDomain, AdminLookupOption[]>;

const DOMAIN_ORDER: readonly LookupDomain[] = [
  "department",
  "position",
  "budget_category",
  "unit_pengaju",
  "transport_need",
  "area",
  "rab_category",
];

type EditorMode =
  | { kind: "create"; domain: LookupDomain }
  | { kind: "edit"; row: AdminLookupOption };

type FormValues = {
  code: string;
  label: string;
  description: string;
  sort_order: string;
  is_active: boolean;
};

const DEFAULT_VALUES: FormValues = {
  code: "",
  label: "",
  description: "",
  sort_order: "100",
  is_active: true,
};

export function LookupManager({ buckets }: { buckets: DomainBucket }) {
  const t = useTranslations("settings.lookups");
  const tDomains = useTranslations("settings.lookups.domains");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [editor, setEditor] = React.useState<EditorMode | null>(null);
  const [deleteTarget, setDeleteTarget] =
    React.useState<AdminLookupOption | null>(null);
  const [isPending, startTransition] = React.useTransition();
  const [activeDomain, setActiveDomain] = React.useState<LookupDomain>(
    DOMAIN_ORDER[0],
  );

  const form = useForm<FormValues>({ defaultValues: DEFAULT_VALUES });

  // Reset the form whenever the editor target changes.
  React.useEffect(() => {
    if (editor?.kind === "edit") {
      const r = editor.row;
      form.reset({
        code: r.code,
        label: r.label,
        description: r.description ?? "",
        sort_order: String(r.sort_order ?? 100),
        is_active: r.is_active,
      });
    } else if (editor?.kind === "create") {
      form.reset(DEFAULT_VALUES);
    }
  }, [editor, form]);

  const dialogOpen = editor !== null;
  function closeDialog() {
    setEditor(null);
  }

  function onSubmit(values: FormValues) {
    if (!editor) return;
    const sortOrder = Number(values.sort_order);
    const payloadShared = {
      code: values.code.trim(),
      label: values.label.trim(),
      description: values.description.trim() || undefined,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : undefined,
    };

    startTransition(async () => {
      if (editor.kind === "create") {
        const result = await createLookupOptionAction({
          domain: editor.domain,
          is_active: values.is_active,
          ...payloadShared,
        });
        if (result.ok) {
          toast.success(t("createdToast"));
          closeDialog();
          router.refresh();
        } else {
          toast.error(result.reason ?? "Failed to create option.");
        }
      } else {
        const result = await updateLookupOptionAction({
          id: editor.row.id,
          is_active: values.is_active,
          ...payloadShared,
        });
        if (result.ok) {
          toast.success(t("updatedToast"));
          closeDialog();
          router.refresh();
        } else {
          toast.error(result.reason ?? "Failed to update option.");
        }
      }
    });
  }

  function onToggleActive(row: AdminLookupOption, next: boolean) {
    startTransition(async () => {
      const result = await toggleLookupOptionActiveAction({
        id: row.id,
        is_active: next,
      });
      if (result.ok) {
        toast.success(next ? t("activatedToast") : t("deactivatedToast"));
        router.refresh();
      } else {
        toast.error(result.reason ?? "Failed to toggle.");
      }
    });
  }

  function onConfirmDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteLookupOptionAction({ id: deleteTarget.id });
      if (result.ok) {
        toast.success(t("deletedToast"));
        setDeleteTarget(null);
        router.refresh();
      } else {
        toast.error(result.reason ?? "Failed to delete.");
      }
    });
  }

  return (
    <>
      <Tabs
        value={activeDomain}
        onValueChange={(v) => setActiveDomain(v as LookupDomain)}
      >
        <TabsList className="w-full flex-wrap justify-start">
          {DOMAIN_ORDER.map((d) => (
            <TabsTrigger key={d} value={d}>
              {tDomains(d)}
              <Badge
                variant="outline"
                className="ml-2 border-white/10 bg-white/5 px-1.5 py-0 text-[10px]"
              >
                {buckets[d].filter((r) => r.is_active).length}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        {DOMAIN_ORDER.map((d) => (
          <TabsContent key={d} value={d} className="mt-4">
            <Card className="glass">
              <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="font-display text-lg">
                    {tDomains(d)}
                  </CardTitle>
                  <CardDescription>
                    {tDomains(`${d}Hint` as never)}
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  onClick={() => setEditor({ kind: "create", domain: d })}
                >
                  <Plus className="size-4" />
                  {t("addOption")}
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {buckets[d].length === 0 ? (
                  <p className="px-6 pb-6 text-sm text-muted-foreground">
                    {t("domainEmpty")}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr className="text-left">
                          <Th>{t("columns.label")}</Th>
                          <Th>{t("columns.code")}</Th>
                          <Th className="text-right">{t("columns.sort")}</Th>
                          <Th className="text-center">
                            {t("columns.active")}
                          </Th>
                          <Th className="text-right">
                            {t("columns.actions")}
                          </Th>
                        </tr>
                      </thead>
                      <tbody>
                        {buckets[d].map((row) => (
                          <tr
                            key={row.id}
                            className={
                              row.is_active
                                ? "border-t border-white/5"
                                : "border-t border-white/5 opacity-60"
                            }
                          >
                            <Td>
                              <div className="font-medium">{row.label}</div>
                              {row.description ? (
                                <div className="text-xs text-muted-foreground">
                                  {row.description}
                                </div>
                              ) : null}
                            </Td>
                            <Td>
                              <code className="rounded bg-muted/40 px-1.5 py-0.5 text-xs">
                                {row.code}
                              </code>
                            </Td>
                            <Td className="text-right tabular-nums">
                              {row.sort_order}
                            </Td>
                            <Td className="text-center">
                              <Switch
                                checked={row.is_active}
                                onCheckedChange={(next) =>
                                  onToggleActive(row, next)
                                }
                                disabled={isPending}
                                aria-label={t("toggleActive")}
                              />
                            </Td>
                            <Td className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() =>
                                    setEditor({ kind: "edit", row })
                                  }
                                  aria-label={t("editOption")}
                                >
                                  <Pencil className="size-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setDeleteTarget(row)}
                                  aria-label={t("deleteOption")}
                                >
                                  <Trash2 className="size-4 text-destructive" />
                                </Button>
                              </div>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* ------------------------------------------------------------------ */}
      {/* Create / edit dialog.                                                */}
      {/* ------------------------------------------------------------------ */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editor?.kind === "edit"
                ? t("editTitle")
                : editor?.kind === "create"
                  ? t("createTitle", { domain: tDomains(editor.domain) })
                  : ""}
            </DialogTitle>
            <DialogDescription>{t("editDescription")}</DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-col gap-4"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.code")} *</FormLabel>
                      <FormControl>
                        <Input placeholder="NOC-JKT" {...field} />
                      </FormControl>
                      <FormDescription>{t("form.codeHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="label"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.label")} *</FormLabel>
                      <FormControl>
                        <Input placeholder="NOC Jakarta" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.description")}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder={t("form.descriptionPlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="sort_order"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.sortOrder")}</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" {...field} />
                      </FormControl>
                      <FormDescription>
                        {t("form.sortOrderHint")}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="is_active"
                  render={({ field }) => (
                    <FormItem className="flex flex-col justify-end gap-2 pb-1">
                      <FormLabel>{t("form.isActive")}</FormLabel>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                        <span className="text-sm text-muted-foreground">
                          {field.value ? t("form.active") : t("form.inactive")}
                        </span>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <DialogClose
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
                  {tCommon("save")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* Delete confirm dialog.                                               */}
      {/* ------------------------------------------------------------------ */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteDescription")}</DialogDescription>
          </DialogHeader>
          {deleteTarget ? (
            <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <div className="font-medium">{deleteTarget.label}</div>
              <code className="text-xs text-muted-foreground">
                {deleteTarget.code}
              </code>
            </div>
          ) : null}
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="ghost" disabled={isPending}>
                  {tCommon("cancel")}
                </Button>
              }
            />
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirmDelete}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {t("confirmDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-2 align-top ${className ?? ""}`}>{children}</td>;
}
