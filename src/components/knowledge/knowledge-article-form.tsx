"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Eye, Globe, Lock, Save, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import {
  createKnowledgeArticleAction,
  updateKnowledgeArticleAction,
} from "@/app/(app)/knowledge/actions";
import { HelpMarkdown } from "@/components/help/help-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectPickerRow } from "@/lib/data/projects";
import {
  CANONICAL_ROLE_LABELS,
  CANONICAL_ROLES,
  type CanonicalRole,
} from "@/lib/rbac/roles";
import {
  KNOWLEDGE_ARTICLE_CATEGORIES,
  KNOWLEDGE_ARTICLE_VISIBILITIES,
  type KnowledgeArticleCategory,
  type KnowledgeArticleVisibility,
} from "@/lib/validation/knowledge-article";

type Mode =
  | { kind: "create" }
  | {
      kind: "edit";
      articleId: string;
      originalSlug: string;
    };

/**
 * Canonical roles surfaced in the ROLE_GATED picker. `CLIENT` is a
 * portal-only role (lives on `client_users`, not `employees`) so it
 * has no meaning for internal KB content and is filtered out.
 */
const KB_ROLE_OPTIONS = CANONICAL_ROLES;

/**
 * Icon lookup for each visibility mode. Kept alongside the role
 * constant so the form's radio card + the reader/list badge stay
 * visually consistent.
 */
const VISIBILITY_ICON: Record<
  KnowledgeArticleVisibility,
  React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  TENANT_WIDE: Globe,
  ROLE_GATED: Users,
  PROJECT_SCOPED: Lock,
};

/**
 * Author form shared by /knowledge/new and /knowledge/{slug}/edit.
 *
 * Design choices:
 *   • Single flat form — title, slug, category, summary, body — no
 *     wizard. The KB is optimised for velocity; a multi-step form
 *     would kill the "quickly capture an SOP" use case.
 *   • Live preview toggle to the right of the editor (below on
 *     narrow viewports). Uses the same `HelpMarkdown` component as
 *     the reader so authors can trust WYSIWYG parity.
 *   • Slug auto-generates from the title (kebab-case) on first
 *     input but stops overriding as soon as the author touches the
 *     slug field. Matches the pattern in `HelpSearch` for
 *     server-cost-conscious defaults.
 */
export function KnowledgeArticleForm({
  mode,
  initial,
  projects,
}: {
  mode: Mode;
  initial?: {
    slug: string;
    title: string;
    summary: string | null;
    body_md: string;
    category: KnowledgeArticleCategory;
    visibility?: KnowledgeArticleVisibility;
    visibility_roles?: readonly string[];
    visibility_project_id?: string | null;
  };
  projects: readonly ProjectPickerRow[];
}) {
  const t = useTranslations("knowledge.form");
  const tv = useTranslations("knowledge.visibility");
  const router = useRouter();

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(mode.kind === "edit");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [body, setBody] = useState(initial?.body_md ?? "");
  const [category, setCategory] = useState<KnowledgeArticleCategory>(
    initial?.category ?? "user-guides",
  );
  const [visibility, setVisibility] = useState<KnowledgeArticleVisibility>(
    initial?.visibility ?? "TENANT_WIDE",
  );
  // Coerce inbound array into a Set for O(1) toggle. `visibility_roles`
  // is stored as string[] because the DB accepts either dialect;
  // canonical is what the picker emits so hydration keeps whatever
  // was stored (canonical or legacy) — the read-side filter matches
  // both via `roleInGate` semantics.
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(
    () => new Set(initial?.visibility_roles ?? []),
  );
  const [projectId, setProjectId] = useState<string | null>(
    initial?.visibility_project_id ?? null,
  );
  const [preview, setPreview] = useState(false);
  const [isPending, startTransition] = useTransition();

  const derivedSlug = useMemo(() => slugify(title), [title]);
  const effectiveSlug = slugTouched ? slug : derivedSlug;

  // Cross-field guard mirroring the Zod `superRefine` — kept in JS so
  // the submit button surfaces the same "at least one role" /
  // "pick a project" invariant before a round-trip.
  const visibilityOk =
    visibility === "TENANT_WIDE" ||
    (visibility === "ROLE_GATED" && selectedRoles.size > 0) ||
    (visibility === "PROJECT_SCOPED" && projectId !== null);

  const canSubmit =
    title.trim().length >= 3 &&
    body.trim().length >= 1 &&
    effectiveSlug.length >= 3 &&
    visibilityOk;

  function toggleRole(role: string) {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;

        startTransition(async () => {
          const visibilityPayload = buildVisibilityPayload(
            visibility,
            selectedRoles,
            projectId,
          );
          if (mode.kind === "create") {
            const res = await createKnowledgeArticleAction({
              slug: effectiveSlug,
              title: title.trim(),
              summary: summary.trim() || undefined,
              body_md: body,
              category,
              ...visibilityPayload,
            });
            if (res.ok) {
              toast.success(t("createdToast"));
              router.push(`/knowledge/${res.data.slug}`);
              router.refresh();
            } else {
              toast.error(res.reason);
            }
          } else {
            const res = await updateKnowledgeArticleAction({
              id: mode.articleId,
              slug: effectiveSlug === mode.originalSlug ? undefined : effectiveSlug,
              title: title.trim(),
              summary: summary.trim(),
              body_md: body,
              category,
              ...visibilityPayload,
            });
            if (res.ok) {
              toast.success(t("savedToast"));
              router.push(`/knowledge/${res.data.slug}`);
              router.refresh();
            } else {
              toast.error(res.reason);
            }
          }
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="knowledge-title">{t("titleLabel")}</Label>
          <Input
            id="knowledge-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            placeholder={t("titlePlaceholder")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="knowledge-slug">{t("slugLabel")}</Label>
          <Input
            id="knowledge-slug"
            value={effectiveSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            maxLength={80}
            required
            placeholder="e.g. onboarding-checklist"
            pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
          />
          <p className="text-xs text-muted-foreground">
            {t("slugHint")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-2">
          <Label htmlFor="knowledge-summary">{t("summaryLabel")}</Label>
          <Textarea
            id="knowledge-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            maxLength={400}
            placeholder={t("summaryPlaceholder")}
          />
          <p className="text-xs text-muted-foreground">
            {summary.length}/400 · {t("summaryHint")}
          </p>
        </div>
        <div className="flex flex-col gap-2 md:min-w-56">
          <Label>{t("categoryLabel")}</Label>
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as KnowledgeArticleCategory)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KNOWLEDGE_ARTICLE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`category.${c}` as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-lg border bg-muted/10 p-4">
        <legend className="px-1 text-sm font-medium">
          {t("visibilityLabel")}
        </legend>
        <p className="-mt-1 text-xs text-muted-foreground">
          {t("visibilityHint")}
        </p>
        <div
          className="grid gap-2 md:grid-cols-3"
          role="radiogroup"
          aria-label={t("visibilityLabel")}
        >
          {KNOWLEDGE_ARTICLE_VISIBILITIES.map((mode) => {
            const Icon = VISIBILITY_ICON[mode];
            const active = visibility === mode;
            return (
              <label
                key={mode}
                className={`group flex cursor-pointer gap-2 rounded-md border p-3 transition ${
                  active
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border/60 hover:border-border hover:bg-muted/30"
                }`}
              >
                <input
                  type="radio"
                  name="knowledge-visibility"
                  value={mode}
                  checked={active}
                  onChange={() => setVisibility(mode)}
                  className="mt-1 size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon
                      className="size-3.5 text-muted-foreground"
                      aria-hidden
                    />
                    {tv(mode)}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {tv(`${mode}_hint`)}
                  </p>
                </div>
              </label>
            );
          })}
        </div>

        {visibility === "ROLE_GATED" && (
          <div className="mt-1 flex flex-col gap-2 rounded-md border border-dashed bg-background/50 p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("visibilityRolesLabel")}
              </Label>
              <span className="text-xs text-muted-foreground">
                {selectedRoles.size === 0
                  ? t("visibilityRolesEmpty")
                  : `${selectedRoles.size} · ${[...selectedRoles]
                      .map(
                        (r) =>
                          CANONICAL_ROLE_LABELS[r as CanonicalRole] ?? r,
                      )
                      .join(", ")}`}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {KB_ROLE_OPTIONS.map((role) => (
                <label
                  key={role}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm hover:border-border/60 hover:bg-muted/40"
                >
                  <Checkbox
                    checked={selectedRoles.has(role)}
                    onCheckedChange={() => toggleRole(role)}
                  />
                  <span>{CANONICAL_ROLE_LABELS[role]}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("visibilityRolesHint")}
            </p>
          </div>
        )}

        {visibility === "PROJECT_SCOPED" && (
          <div className="mt-1 flex flex-col gap-2 rounded-md border border-dashed bg-background/50 p-3">
            <Label
              className="text-xs uppercase tracking-wide text-muted-foreground"
              htmlFor="knowledge-visibility-project"
            >
              {t("visibilityProjectLabel")}
            </Label>
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("visibilityProjectEmpty")}
              </p>
            ) : (
              <Select
                value={projectId ?? undefined}
                onValueChange={(v) => setProjectId(v)}
              >
                <SelectTrigger id="knowledge-visibility-project">
                  <SelectValue placeholder={t("visibilityProjectPlaceholder")}>
                    {projectId
                      ? renderProjectLabel(projects, projectId)
                      : t("visibilityProjectPlaceholder")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px] uppercase tracking-wider"
                        >
                          {p.code}
                        </Badge>
                        <span>{p.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              {t("visibilityProjectHint")}
            </p>
          </div>
        )}
      </fieldset>

      <div className="flex items-center justify-between">
        <Label htmlFor="knowledge-body">{t("bodyLabel")}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? (
            <>
              <Sparkles className="size-3.5" aria-hidden />
              {t("edit")}
            </>
          ) : (
            <>
              <Eye className="size-3.5" aria-hidden />
              {t("preview")}
            </>
          )}
        </Button>
      </div>
      {preview ? (
        <div className="min-h-[24rem] rounded-md border bg-muted/20 p-4">
          <article className="prose prose-slate max-w-3xl dark:prose-invert prose-headings:font-display prose-headings:tracking-tight">
            <HelpMarkdown markdown={body || t("emptyPreview")} />
          </article>
        </div>
      ) : (
        <Textarea
          id="knowledge-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={24}
          className="font-mono text-sm"
          placeholder={t("bodyPlaceholder")}
          required
        />
      )}

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
        >
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={!canSubmit || isPending}>
          <Save className="size-3.5" aria-hidden />
          {mode.kind === "create" ? t("saveDraft") : t("save")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Convert an arbitrary user string into the constrained slug form
 * (lower-case letters, digits, single hyphens; matches the regex on
 * `slugSchema`). Trims to 80 chars to align with the DB check.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Normalise visibility side fields against the chosen mode. Mirrors
 * the server-action normalisation in
 * `src/app/(app)/knowledge/actions.ts` so the request payload never
 * carries stale roles / project id from a mode toggle. Sending the
 * empty side fields is intentional — the update action wipes them
 * when visibility changes, which keeps the DB CHECK constraint
 * (0098) happy on the atomic UPDATE.
 */
function buildVisibilityPayload(
  visibility: KnowledgeArticleVisibility,
  selectedRoles: Set<string>,
  projectId: string | null,
): {
  visibility: KnowledgeArticleVisibility;
  visibility_roles: string[];
  visibility_project_id: string | null;
} {
  return {
    visibility,
    visibility_roles:
      visibility === "ROLE_GATED" ? Array.from(selectedRoles) : [],
    visibility_project_id:
      visibility === "PROJECT_SCOPED" ? projectId : null,
  };
}

function renderProjectLabel(
  projects: readonly ProjectPickerRow[],
  id: string,
): React.ReactNode {
  const project = projects.find((p) => p.id === id);
  if (!project) return id;
  return (
    <span className="flex items-center gap-2">
      <Badge
        variant="outline"
        className="font-mono text-[10px] uppercase tracking-wider"
      >
        {project.code}
      </Badge>
      <span>{project.name}</span>
    </span>
  );
}
