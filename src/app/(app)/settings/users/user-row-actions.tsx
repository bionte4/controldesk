"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import {
  LogOut,
  MoreHorizontal,
  ShieldAlert,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CANONICAL_ROLES,
  CANONICAL_ROLE_LABELS,
  toCanonicalRole,
  type AnyDbEmployeeRole,
  type CanonicalRole,
} from "@/lib/rbac/roles";
import {
  changeUserRoleSchema,
  forceLogoutSchema,
  setUserStatusSchema,
  type ChangeUserRoleInput,
  type ForceLogoutInput,
  type SetUserStatusInput,
} from "@/lib/validation/user-admin";

import {
  changeUserRoleAction,
  forceLogoutUserAction,
  setUserStatusAction,
} from "./actions";

/**
 * Row-level action menu for `/settings/users`. Rendered ONLY when the actor
 * is a TENANT_ADMIN AND the target row is NOT the actor themselves (guarded
 * server-side too, but hiding the trigger here saves an obvious footgun).
 *
 * Three modal flows, all sharing the same confirmation-dialog scaffold to
 * keep the interaction consistent:
 *   1. Change role         — pick new canonical role + optional reason
 *   2. Deactivate / reactivate — toggle status + optional reason
 *   3. Force logout        — revoke sessions immediately + optional reason
 *
 * The reason field feeds into `security_audit_logs.metadata.reason` (via the
 * server action) so audit reviewers can trace WHY a mutation happened.
 */
export function UserRowActions({
  userId,
  employeeId,
  currentRole,
  isActive,
  targetEmail,
  isSelf,
}: {
  userId: string;
  employeeId: string | null;
  currentRole: CanonicalRole | null;
  isActive: boolean;
  targetEmail: string | null;
  isSelf: boolean;
}) {
  const t = useTranslations("settings.users.actions");
  const [isPending, startTransition] = React.useTransition();
  const [openMenu, setOpenMenu] = React.useState<
    "none" | "role" | "status" | "logout"
  >("none");

  const close = React.useCallback(() => setOpenMenu("none"), []);

  const canMutate = !isSelf && employeeId != null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="sm"
              variant="ghost"
              disabled={!canMutate || isPending}
              aria-label={t("openMenu")}
              title={
                isSelf
                  ? t("selfDisabledHint")
                  : !employeeId
                    ? t("missingEmployeeHint")
                    : undefined
              }
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{t("menuLabel")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpenMenu("role")}>
            <UserCog className="size-3.5" />
            <span className="ml-2">{t("changeRole")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpenMenu("status")}>
            {isActive ? (
              <>
                <ShieldAlert className="size-3.5" />
                <span className="ml-2">{t("deactivate")}</span>
              </>
            ) : (
              <>
                <ShieldCheck className="size-3.5" />
                <span className="ml-2">{t("reactivate")}</span>
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpenMenu("logout")}>
            <LogOut className="size-3.5" />
            <span className="ml-2">{t("forceLogout")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangeRoleDialog
        open={openMenu === "role"}
        onOpenChange={(v) => (v ? setOpenMenu("role") : close())}
        userId={userId}
        targetEmail={targetEmail}
        currentRole={currentRole}
        onDone={close}
        pending={isPending}
        startTransition={startTransition}
      />

      <StatusDialog
        open={openMenu === "status"}
        onOpenChange={(v) => (v ? setOpenMenu("status") : close())}
        userId={userId}
        targetEmail={targetEmail}
        isActive={isActive}
        onDone={close}
        pending={isPending}
        startTransition={startTransition}
      />

      <ForceLogoutDialog
        open={openMenu === "logout"}
        onOpenChange={(v) => (v ? setOpenMenu("logout") : close())}
        userId={userId}
        targetEmail={targetEmail}
        onDone={close}
        pending={isPending}
        startTransition={startTransition}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-dialog: Change role
// ---------------------------------------------------------------------------

function ChangeRoleDialog({
  open,
  onOpenChange,
  userId,
  targetEmail,
  currentRole,
  onDone,
  pending,
  startTransition,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  targetEmail: string | null;
  currentRole: CanonicalRole | null;
  onDone: () => void;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const t = useTranslations("settings.users.changeRole");
  const tRoles = useTranslations("settings.users.canonicalRole");
  const tCommon = useTranslations("common");

  const form = useForm<ChangeUserRoleInput>({
    defaultValues: {
      user_id: userId,
      new_role: currentRole ?? "EMPLOYEE",
      reason: undefined,
    },
    resolver: zodResolver(changeUserRoleSchema) as unknown as Resolver<
      ChangeUserRoleInput
    >,
  });

  // Reset when re-opened for a different row.
  React.useEffect(() => {
    if (open) {
      form.reset({
        user_id: userId,
        new_role: currentRole ?? "EMPLOYEE",
        reason: undefined,
      });
    }
  }, [open, userId, currentRole, form]);

  const onSubmit = (values: ChangeUserRoleInput) => {
    startTransition(async () => {
      const result = await changeUserRoleAction(values);
      if (result.ok) {
        toast.success(
          t("submittedToast", {
            email: targetEmail ?? "",
            sessions: result.data.sessions_revoked,
          }),
        );
        onDone();
      } else {
        toast.error(result.reason);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { email: targetEmail ?? "" })}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="new_role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("newRole")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {tRoles(field.value as CanonicalRole)}
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CANONICAL_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {CANONICAL_ROLE_LABELS[r]}
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
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("reason")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      placeholder={t("reasonPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-foreground/90">
              {t("sessionWarning")}
            </p>

            <DialogFooter className="flex-row justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {t("submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub-dialog: Deactivate / Reactivate
// ---------------------------------------------------------------------------

function StatusDialog({
  open,
  onOpenChange,
  userId,
  targetEmail,
  isActive,
  onDone,
  pending,
  startTransition,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  targetEmail: string | null;
  isActive: boolean;
  onDone: () => void;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const t = useTranslations("settings.users.status");
  const tCommon = useTranslations("common");
  const key = isActive ? "deactivate" : "reactivate";

  const form = useForm<SetUserStatusInput>({
    defaultValues: {
      user_id: userId,
      active: !isActive,
      reason: undefined,
    },
    resolver: zodResolver(setUserStatusSchema) as unknown as Resolver<
      SetUserStatusInput
    >,
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        user_id: userId,
        active: !isActive,
        reason: undefined,
      });
    }
  }, [open, userId, isActive, form]);

  const onSubmit = (values: SetUserStatusInput) => {
    startTransition(async () => {
      const result = await setUserStatusAction(values);
      if (result.ok) {
        toast.success(t(`${key}Toast`, { email: targetEmail ?? "" }));
        onDone();
      } else {
        toast.error(result.reason);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(`${key}Title`)}</DialogTitle>
          <DialogDescription>
            {t(`${key}Description`, { email: targetEmail ?? "" })}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("reason")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      placeholder={t("reasonPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="flex-row justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={pending}
                variant={isActive ? "destructive" : "default"}
              >
                {t(`${key}Confirm`)}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub-dialog: Force logout
// ---------------------------------------------------------------------------

function ForceLogoutDialog({
  open,
  onOpenChange,
  userId,
  targetEmail,
  onDone,
  pending,
  startTransition,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  targetEmail: string | null;
  onDone: () => void;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const t = useTranslations("settings.users.forceLogout");
  const tCommon = useTranslations("common");

  const form = useForm<ForceLogoutInput>({
    defaultValues: { user_id: userId, reason: undefined },
    resolver: zodResolver(forceLogoutSchema) as unknown as Resolver<
      ForceLogoutInput
    >,
  });

  React.useEffect(() => {
    if (open) form.reset({ user_id: userId, reason: undefined });
  }, [open, userId, form]);

  const onSubmit = (values: ForceLogoutInput) => {
    startTransition(async () => {
      const result = await forceLogoutUserAction(values);
      if (result.ok) {
        toast.success(
          t("submittedToast", {
            email: targetEmail ?? "",
            sessions: result.data.sessions_revoked,
          }),
        );
        onDone();
      } else {
        toast.error(result.reason);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { email: targetEmail ?? "" })}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("reason")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      placeholder={t("reasonPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="flex-row justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={pending} variant="destructive">
                {t("submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Utility: map a raw DB role to the canonical enum for the row-action
 * component. Kept here so `page.tsx` doesn't need to know the mapping.
 */
export function toCanonicalRoleSafe(
  role: string | null | undefined,
): CanonicalRole | null {
  if (!role) return null;
  return toCanonicalRole(role as AnyDbEmployeeRole);
}
