"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import {
  markSecretRotatedSchema,
  type MarkSecretRotatedInput,
} from "@/lib/validation/rotation";

import { markSecretRotatedAction } from "./actions";

/**
 * "Mark rotated" affordance in `/settings/secrets`. Bumps `last_rotated_at`
 * for the row via `markSecretRotatedAction` (TENANT_ADMIN only, audit
 * `UPDATE` on `secret_rotations`). Renders a Dialog because rotating a
 * secret is an operational commitment that deserves a confirmation
 * checkpoint — no accidental clicks.
 */
export function MarkRotatedButton({ name }: { name: string }) {
  const t = useTranslations("settings.secrets.actions");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<MarkSecretRotatedInput>({
    resolver: zodResolver(markSecretRotatedSchema),
    defaultValues: { name, notes: "" },
  });

  function onSubmit(values: MarkSecretRotatedInput) {
    startTransition(async () => {
      const res = await markSecretRotatedAction(values);
      if (!res.ok) {
        toast.error(res.reason ?? t("markFailed"));
        return;
      }
      toast.success(t("markSuccess", { name }));
      setOpen(false);
      form.reset({ name, notes: "" });
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            aria-label={t("markRotated")}
          >
            <RotateCcw className="size-3.5" />
            {t("markRotated")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("markRotatedTitle", { name })}</DialogTitle>
          <DialogDescription>{t("markRotatedDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-3"
          >
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("notesLabel")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder={t("notesPlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Check className="mr-2 size-4" />
                )}
                {t("confirmMarkRotated")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
