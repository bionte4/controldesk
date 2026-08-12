"use client";

/**
 * ControlDesk — Unified approval action dialog (rules §14).
 *
 * Every finance / approval surface (Expense / Cash Advance / Budget /
 * Budget Request / HR Request / Timesheet / Handover) ships the same
 * shape for Approve / Reject / Disburse / Cancel dialogs:
 *
 *   1. Trigger button (variant, icon, label).
 *   2. Modal dialog with a title + description.
 *   3. React-Hook-Form + Zod-validated form with 1–2 fields
 *      (Textarea for comment/reason, Input for reference numbers).
 *   4. Footer with Cancel + Confirm buttons; confirm goes destructive
 *      for `intent="reject"`.
 *   5. `useTransition` + Sonner toast + `router.refresh()` on success.
 *
 * Before this component landed those five stanzas were copy-pasted across
 * 5 files (1295 LoC combined). This component encapsulates the whole
 * ceremony behind one polymorphic call site — callers pass a `schema`,
 * a `fields` config, and a Server Action; everything else is derived.
 *
 * ## Type-safety note
 *
 * The generic `TSchema extends z.ZodType<FieldValues>` propagates through
 * to `useForm<z.input<TSchema>>` so the field `name` prop still enjoys
 * Zod's autocomplete. The `action` callback receives `z.output<TSchema>`
 * — i.e. the validated shape — even though the input carries the
 * pre-transform values. This mirrors what every hand-rolled dialog did.
 *
 * ## Design constraints (rules §17, §23)
 *
 * - Server Action must return `ActionResult<T>` shape (`{ok, reason?}`);
 *   this component is oblivious to what the action mutates. The wrapper
 *   layer (`withSecureAction`) already enforces audit + RBAC.
 * - Toast on failure uses `result.reason` verbatim — callers should
 *   ensure this is already localised (or wrap the action to translate).
 * - Trigger button `disabled` is orthogonal to the intent variant so
 *   parents can suppress it based on state (e.g. hide reject when the
 *   row is already Approved).
 * - `router.refresh()` on success re-runs the current RSC page so status
 *   badges, timelines, and cached data all move in lock-step.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  useForm,
  type Control,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Ban,
  Check,
  Loader2,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Semantic intent — drives the default trigger button variant + icon.
 * Callers can override via `icon` prop if the module has a custom action
 * (e.g. `"custom"` for one-off flows).
 */
export type ApprovalActionIntent =
  | "approve"
  | "reject"
  | "disburse"
  | "return"
  | "cancel"
  | "submit"
  | "custom";

/**
 * Field renderer config. `kind` defaults to `"textarea"` because the
 * overwhelming majority of approval dialogs carry a free-form
 * comment/reason field.
 */
export type ApprovalActionField = {
  name: string;
  label: string;
  placeholder?: string;
  kind?: "textarea" | "input";
  rows?: number;
};

/**
 * Shape the Server Action must return. Matches `ActionResult<T>` from
 * `withSecureAction` — the T payload is ignored here because approval
 * flows mutate but don't need to hand data back to the client (they
 * refresh the RSC tree instead).
 */
export type ApprovalActionResult =
  | { ok: true; data?: unknown }
  | { ok: false; reason?: string; code?: string };

export type ApprovalActionDialogProps<TValues extends FieldValues> = {
  /** Drives trigger button variant + icon default (unless overridden). */
  intent: ApprovalActionIntent;
  /**
   * Zod schema for the form. Constrained to `z.ZodType<TValues>` so
   * inference flows both directions — the caller passes the concrete
   * schema and TValues gets inferred from it (or vice versa).
   */
  schema: z.ZodType<TValues>;
  /** Initial form values (must include primary key like `id`). */
  defaultValues: TValues;
  /** Fields to render inside the dialog form. */
  fields: readonly ApprovalActionField[];
  /** Server Action to call on submit — return ActionResult shape. */
  action: (values: TValues) => Promise<ApprovalActionResult>;
  /** Trigger button label. */
  triggerLabel: string;
  /** Dialog header title. */
  title: string;
  /** Dialog header description (helper text under the title). */
  description: string;
  /** Confirm-submit button label. */
  confirmLabel: string;
  /** Cancel button label. */
  cancelLabel: string;
  /** Toast shown on `ok: true` response. */
  successToast: string;
  /** Optional generic error fallback for `ok: false` w/o `reason`. */
  errorFallback?: string;
  /** Suppress the trigger button (parent decides when it's available). */
  disabled?: boolean;
  /** Trigger button size (matches `<Button size>`). Defaults to "sm". */
  triggerSize?: "sm" | "default";
  /**
   * Override the intent's default icon. Useful for flows that need a
   * custom visual (e.g. `<Trash2 />` for a destructive delete).
   */
  icon?: React.ReactNode;
  /**
   * Force the confirm button to a specific variant. Defaults are
   * derived from intent (`reject` → destructive, everything else →
   * default). Pass `"destructive"` to force red on non-reject flows
   * (e.g. cancel).
   */
  confirmVariant?: "default" | "destructive" | "outline";
  /** Test hook prefix. */
  testId?: string;
};

const INTENT_DEFAULTS: Record<
  ApprovalActionIntent,
  {
    variant: "default" | "destructive" | "outline";
    icon: React.ReactNode;
  }
> = {
  approve: { variant: "default", icon: <Check className="size-4" /> },
  reject: { variant: "destructive", icon: <X className="size-4" /> },
  disburse: { variant: "default", icon: <Send className="size-4" /> },
  return: { variant: "outline", icon: <RotateCcw className="size-4" /> },
  cancel: { variant: "outline", icon: <Ban className="size-4" /> },
  submit: { variant: "default", icon: <Send className="size-4" /> },
  custom: { variant: "default", icon: <Check className="size-4" /> },
};

export function ApprovalActionDialog<TValues extends FieldValues>({
  intent,
  schema,
  defaultValues,
  fields,
  action,
  triggerLabel,
  title,
  description,
  confirmLabel,
  cancelLabel,
  successToast,
  errorFallback = "Terjadi kesalahan",
  disabled = false,
  triggerSize = "sm",
  icon,
  confirmVariant,
  testId,
}: ApprovalActionDialogProps<TValues>) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);

  // `zodResolver` types are cross-major (Zod v3 vs v4) and diverge from
  // the schema<TValues> we accept — the runtime behaviour is fine, so
  // narrow via cast at the entry point.
  const form = useForm<TValues>({
    resolver: zodResolver(
      schema as unknown as z.ZodType<TValues, TValues>,
    ) as never,
    defaultValues: defaultValues as never,
  });

  const { variant: triggerVariant, icon: defaultIcon } =
    INTENT_DEFAULTS[intent];
  const effectiveConfirmVariant =
    confirmVariant ?? (intent === "reject" ? "destructive" : "default");

  function onSubmit(values: TValues) {
    startTransition(async () => {
      const result = await action(values);
      if (result.ok) {
        toast.success(successToast);
        setOpen(false);
        form.reset(defaultValues as never);
        // Re-run the RSC tree so status badges, timelines, and gated
        // action bars all reflect the new state without a manual reload.
        router.refresh();
      } else {
        toast.error(result.reason ?? errorFallback);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size={triggerSize}
            variant={triggerVariant}
            disabled={disabled}
            data-testid={testId ? `${testId}-trigger` : undefined}
          >
            {icon ?? defaultIcon}
            {triggerLabel}
          </Button>
        }
      />
      <DialogContent
        className="sm:max-w-md"
        data-testid={testId ? `${testId}-dialog` : undefined}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {/*
         * `<Form>` (Shadcn wrapper around FormProvider) is invariant in
         * its `TFieldValues` generic, so once we widen to FieldValues
         * here the whole subtree needs the same widening. The Zod
         * schema still enforces shape at runtime — this cast is purely
         * to satisfy the compiler for the polymorphic entry point.
         */}
        <Form {...(form as unknown as UseFormReturn<FieldValues>)}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-3"
          >
            {fields.map((f) => (
              <FormField
                key={f.name}
                control={form.control as unknown as Control<FieldValues>}
                // `f.name` originates from a user-supplied config; we
                // widen to `Path<FieldValues>` here for the same
                // variance reason as the `<Form>` cast above. Zod
                // schema still enforces shape at runtime.
                name={f.name as Path<FieldValues>}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{f.label}</FormLabel>
                    <FormControl>
                      {f.kind === "input" ? (
                        <Input
                          placeholder={f.placeholder}
                          value={(field.value as string | undefined) ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                        />
                      ) : (
                        <Textarea
                          rows={f.rows ?? 3}
                          placeholder={f.placeholder}
                          value={(field.value as string | undefined) ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                        />
                      )}
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                {cancelLabel}
              </Button>
              <Button
                type="submit"
                variant={effectiveConfirmVariant}
                disabled={isPending}
                data-testid={testId ? `${testId}-submit` : undefined}
              >
                {isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                {confirmLabel}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
