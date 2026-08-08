"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Plus, Search } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { CoaAccountWithChildren } from "@/lib/data/coa";
import type { CoaAccountType, CoaNormalSide } from "@/types/database";

import {
  createCoaAction,
  toggleCoaActiveAction,
  updateCoaAction,
} from "./actions";

type FormValues = {
  code: string;
  name: string;
  account_type: CoaAccountType;
  normal_side: CoaNormalSide;
  parent_id: string;
  is_postable: boolean;
  description: string;
};

const DEFAULT_VALUES: FormValues = {
  code: "",
  name: "",
  account_type: "EXPENSE",
  normal_side: "DEBIT",
  parent_id: "",
  is_postable: true,
  description: "",
};

const ACCOUNT_TYPE_OPTIONS: readonly CoaAccountType[] = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
];

type EditorMode =
  | { kind: "create"; presetParent?: { id: string; type: CoaAccountType } }
  | { kind: "edit"; row: FlatAccount };

type FlatAccount = {
  id: string;
  code: string;
  name: string;
  account_type: CoaAccountType;
  normal_side: CoaNormalSide;
  parent_id: string | null;
  is_postable: boolean;
  is_active: boolean;
  description: string | null;
  depth: number;
};

/**
 * Enforces the same normal-side ↔ account-type invariant as the DB
 * CHECK constraint (migration 0055). Called on account_type change so
 * users don't have to think about it — but the field stays editable
 * for edge cases (contra-accounts) that we validate on submit.
 */
function normalSideForType(type: CoaAccountType): CoaNormalSide {
  return type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT";
}

/**
 * Depth-first flatten of the tree — preserves the display order while
 * exposing every row for the table view + parent picker. `depth` is
 * carried over from the loader so the indentation matches.
 */
function flattenTree(tree: CoaAccountWithChildren[]): FlatAccount[] {
  const out: FlatAccount[] = [];
  const visit = (node: CoaAccountWithChildren) => {
    out.push({
      id: node.id,
      code: node.code,
      name: node.name,
      account_type: node.account_type,
      normal_side: node.normal_side,
      parent_id: node.parent_id,
      is_postable: node.is_postable,
      is_active: node.is_active,
      description: node.description,
      depth: node.depth,
    });
    for (const c of node.children) visit(c);
  };
  for (const root of tree) visit(root);
  return out;
}

export function CoaManager({ tree }: { tree: CoaAccountWithChildren[] }) {
  const t = useTranslations("settings.coa");
  const tTypes = useTranslations("settings.coa.types");
  const tSides = useTranslations("settings.coa.sides");
  const router = useRouter();

  const rows = React.useMemo(() => flattenTree(tree), [tree]);

  const [editor, setEditor] = React.useState<EditorMode | null>(null);
  const [query, setQuery] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<CoaAccountType | "ALL">(
    "ALL",
  );
  const [showInactive, setShowInactive] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<FormValues>({ defaultValues: DEFAULT_VALUES });

  React.useEffect(() => {
    if (!editor) return;
    if (editor.kind === "edit") {
      form.reset({
        code: editor.row.code,
        name: editor.row.name,
        account_type: editor.row.account_type,
        normal_side: editor.row.normal_side,
        parent_id: editor.row.parent_id ?? "",
        is_postable: editor.row.is_postable,
        description: editor.row.description ?? "",
      });
    } else {
      const type = editor.presetParent?.type ?? "EXPENSE";
      form.reset({
        ...DEFAULT_VALUES,
        account_type: type,
        normal_side: normalSideForType(type),
        parent_id: editor.presetParent?.id ?? "",
      });
    }
  }, [editor, form]);

  // Filtered rows for the table.
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showInactive && !r.is_active) return false;
      if (typeFilter !== "ALL" && r.account_type !== typeFilter) return false;
      if (!q) return true;
      return (
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, typeFilter, showInactive]);

  // Parent picker options — exclude the row being edited + its descendants
  // (would create a cycle). For "create" we allow any active row as parent.
  const parentOptions = React.useMemo(() => {
    if (!editor) return rows;
    if (editor.kind === "create") {
      return rows.filter((r) => r.is_active);
    }
    // Compute descendant set of editor.row so we can filter it out.
    const banned = new Set<string>([editor.row.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of rows) {
        if (!banned.has(r.id) && r.parent_id && banned.has(r.parent_id)) {
          banned.add(r.id);
          changed = true;
        }
      }
    }
    return rows.filter((r) => !banned.has(r.id) && r.is_active);
  }, [rows, editor]);

  function closeDialog() {
    setEditor(null);
  }

  function onSubmit(values: FormValues) {
    if (!editor) return;
    const payload = {
      code: values.code.trim(),
      name: values.name.trim(),
      account_type: values.account_type,
      normal_side: values.normal_side,
      parent_id: values.parent_id ? values.parent_id : null,
      is_postable: values.is_postable,
      description: values.description.trim() || undefined,
    };

    startTransition(async () => {
      if (editor.kind === "create") {
        const result = await createCoaAction(payload);
        if (result.ok) {
          toast.success(t("createdToast"));
          closeDialog();
          router.refresh();
        } else {
          toast.error(result.reason ?? t("failedCreate"));
        }
      } else {
        const result = await updateCoaAction({
          id: editor.row.id,
          ...payload,
        });
        if (result.ok) {
          toast.success(t("updatedToast"));
          closeDialog();
          router.refresh();
        } else {
          toast.error(result.reason ?? t("failedUpdate"));
        }
      }
    });
  }

  function onToggleActive(row: FlatAccount, next: boolean) {
    startTransition(async () => {
      const result = await toggleCoaActiveAction({
        id: row.id,
        is_active: next,
      });
      if (result.ok) {
        toast.success(next ? t("activatedToast") : t("deactivatedToast"));
        router.refresh();
      } else {
        toast.error(result.reason ?? t("failedToggle"));
      }
    });
  }

  return (
    <>
      <Card className="glass">
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="font-display text-lg">
              {t("accountsTitle")}
            </CardTitle>
            <CardDescription>{t("accountsHint")}</CardDescription>
          </div>
          <Button size="sm" onClick={() => setEditor({ kind: "create" })}>
            <Plus className="size-4" />
            {t("addAccount")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="pl-9"
              />
            </div>
            <Select
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(v as CoaAccountType | "ALL")}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("filterAllTypes")}</SelectItem>
                {ACCOUNT_TYPE_OPTIONS.map((typ) => (
                  <SelectItem key={typ} value={typ}>
                    {tTypes(typ)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={showInactive}
                onCheckedChange={setShowInactive}
              />
              {t("showInactive")}
            </label>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noMatches")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-white/5">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <Th>{t("columns.code")}</Th>
                    <Th>{t("columns.name")}</Th>
                    <Th>{t("columns.type")}</Th>
                    <Th className="text-center">{t("columns.postable")}</Th>
                    <Th className="text-center">{t("columns.active")}</Th>
                    <Th className="text-right">{t("columns.actions")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      className={
                        row.is_active
                          ? "border-t border-white/5"
                          : "border-t border-white/5 opacity-60"
                      }
                    >
                      <Td>
                        <code
                          className="rounded bg-muted/40 px-1.5 py-0.5 text-xs"
                          style={{ marginLeft: `${row.depth * 12}px` }}
                        >
                          {row.code}
                        </code>
                      </Td>
                      <Td>
                        <div className="font-medium">{row.name}</div>
                        {row.description ? (
                          <div className="text-xs text-muted-foreground">
                            {row.description}
                          </div>
                        ) : null}
                      </Td>
                      <Td>
                        <Badge
                          variant="outline"
                          className="border-white/10 bg-white/5 text-[10px]"
                        >
                          {tTypes(row.account_type)} · {tSides(row.normal_side)}
                        </Badge>
                      </Td>
                      <Td className="text-center">
                        {row.is_postable ? (
                          <Badge className="bg-sky-500/15 text-sky-300 hover:bg-sky-500/20">
                            {t("postable")}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t("group")}
                          </span>
                        )}
                      </Td>
                      <Td className="text-center">
                        <Switch
                          checked={row.is_active}
                          disabled={isPending}
                          onCheckedChange={(next) => onToggleActive(row, next)}
                        />
                      </Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() =>
                              setEditor({
                                kind: "create",
                                presetParent: {
                                  id: row.id,
                                  type: row.account_type,
                                },
                              })
                            }
                            aria-label={t("addChild")}
                            title={t("addChild")}
                          >
                            <Plus className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setEditor({ kind: "edit", row })}
                            aria-label={t("edit")}
                            title={t("edit")}
                          >
                            <Pencil className="size-4" />
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

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => (open ? null : closeDialog())}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editor?.kind === "edit" ? t("editTitle") : t("createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editor?.kind === "edit"
                ? t("editDescription")
                : t("createDescription")}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="code"
                  rules={{
                    required: t("codeRequired"),
                    pattern: {
                      value: /^\d{3,10}$/,
                      message: t("codeFormat"),
                    },
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.code")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="5101"
                          inputMode="numeric"
                        />
                      </FormControl>
                      <FormDescription>{t("codeHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="account_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.type")}</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(v) => {
                          const typed = v as CoaAccountType;
                          field.onChange(typed);
                          form.setValue("normal_side", normalSideForType(typed));
                        }}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {ACCOUNT_TYPE_OPTIONS.map((typ) => (
                            <SelectItem key={typ} value={typ}>
                              {tTypes(typ)}
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
                name="name"
                rules={{
                  required: t("nameRequired"),
                  minLength: { value: 2, message: t("nameShort") },
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.name")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("namePlaceholder")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="normal_side"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.normalSide")}</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(v) => field.onChange(v as CoaNormalSide)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="DEBIT">{tSides("DEBIT")}</SelectItem>
                          <SelectItem value="CREDIT">
                            {tSides("CREDIT")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>{t("normalSideHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="parent_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.parent")}</FormLabel>
                      <Select
                        value={field.value || "__none__"}
                        onValueChange={(v) =>
                          field.onChange(v === "__none__" ? "" : v)
                        }
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">
                            {t("parentNone")}
                          </SelectItem>
                          {parentOptions.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {"— ".repeat(r.depth)}
                              {r.code} · {r.name}
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
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.description")}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t("descriptionPlaceholder")}
                        rows={2}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="is_postable"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="space-y-0.5">
                      <FormLabel>{t("fields.postable")}</FormLabel>
                      <FormDescription>
                        {t("postableHint")}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <DialogFooter>
                <DialogClose
                  render={
                    <Button type="button" variant="ghost">
                      {t("cancel")}
                    </Button>
                  }
                />
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : editor?.kind === "edit" ? (
                    t("save")
                  ) : (
                    t("createAccount")
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- Small presentational helpers -------------------------------------------
function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground ${
        className ?? ""
      }`}
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
  return <td className={`px-4 py-2 ${className ?? ""}`}>{children}</td>;
}
