"use client";

import * as React from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Check, Copy, Eye, EyeOff, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  CANONICAL_ROLES,
  CANONICAL_ROLE_LABELS,
  type CanonicalRole,
} from "@/lib/rbac/roles";
import {
  createUserManuallyFormSchema,
  inviteUserSchema,
  type CreateUserManuallyFormInput,
  type InviteUserInput,
} from "@/lib/validation/user-admin";

import { createUserManuallyAction, inviteUserAction } from "./actions";

const INVITE_DEFAULT_VALUES: InviteUserInput = {
  email: "",
  full_name: "",
  role: "EMPLOYEE",
};

type AddMethod = "invite" | "manual";

type ManualFormValues = CreateUserManuallyFormInput;

const MANUAL_DEFAULT_VALUES: ManualFormValues = {
  email: "",
  full_name: "",
  role: "EMPLOYEE",
  password_mode: "auto",
  password: "",
  password_confirmation: "",
};

type ManualCreatedResult = {
  email: string;
  full_name: string;
  temporary_password: string;
  password_auto_generated: boolean;
  login_url: string;
};

/**
 * Add-user drawer. Only TENANT_ADMIN roles get here (server + PDP guard);
 * we still hide behind a button in the parent page so the trigger is only
 * rendered when the actor is eligible.
 *
 * Two creation methods:
 *  - Invite: Supabase sends a magic-link email; the user sets their own
 *    password. This remains the default and safest path.
 *  - Manual: the admin creates a pre-confirmed account with a temporary
 *    password and NO email is sent. The password is shown exactly once in
 *    the success panel for out-of-band handover.
 */
export function InviteUserSheet() {
  const tf = useTranslations("settings.users.invite");
  const tm = useTranslations("settings.users.manual");
  const [open, setOpen] = React.useState(false);
  const [method, setMethod] = React.useState<AddMethod>("invite");
  const [manualResult, setManualResult] =
    React.useState<ManualCreatedResult | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setMethod("invite");
      setManualResult(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger
        render={
          <Button size="sm">
            <UserPlus className="size-4" />
            {tf("openTrigger")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>
            {manualResult
              ? tm("successTitle")
              : method === "invite"
                ? tf("title")
                : tm("title")}
          </SheetTitle>
          <SheetDescription>
            {manualResult
              ? tm("successDescription")
              : method === "invite"
                ? tf("description")
                : tm("description")}
          </SheetDescription>
        </SheetHeader>

        {manualResult ? (
          <ManualCredentialPanel
            result={manualResult}
            onDone={() => handleOpenChange(false)}
          />
        ) : (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div
              className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
              role="group"
              aria-label={tm("methodLabel")}
            >
              <Button
                type="button"
                size="sm"
                variant={method === "invite" ? "default" : "ghost"}
                aria-pressed={method === "invite"}
                onClick={() => setMethod("invite")}
              >
                {tm("modeInvite")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={method === "manual" ? "default" : "ghost"}
                aria-pressed={method === "manual"}
                onClick={() => setMethod("manual")}
              >
                {tm("modeManual")}
              </Button>
            </div>

            {method === "invite" ? (
              <InviteForm onDone={() => handleOpenChange(false)} />
            ) : (
              <ManualForm onCreated={setManualResult} />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RoleSelect({
  value,
  onChange,
}: {
  value: CanonicalRole;
  onChange: (role: CanonicalRole) => void;
}) {
  const tRoles = useTranslations("settings.users.canonicalRole");
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as CanonicalRole)}
    >
      <FormControl>
        <SelectTrigger className="w-full">
          <SelectValue>{tRoles(value)}</SelectValue>
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
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const tf = useTranslations("settings.users.invite");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<InviteUserInput>({
    defaultValues: INVITE_DEFAULT_VALUES,
    resolver: zodResolver(inviteUserSchema) as unknown as Resolver<
      InviteUserInput
    >,
  });

  function onSubmit(values: InviteUserInput) {
    startTransition(async () => {
      const result = await inviteUserAction(values);
      if (result.ok) {
        toast.success(tf("submittedToast", { email: result.data.email }));
        form.reset(INVITE_DEFAULT_VALUES);
        onDone();
      } else {
        toast.error(result.reason);
      }
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-1 flex-col gap-4"
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tf("email")}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  autoComplete="off"
                  placeholder={tf("emailPlaceholder")}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="full_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tf("fullName")}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete="off"
                  placeholder={tf("fullNamePlaceholder")}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tf("role")}</FormLabel>
              <RoleSelect value={field.value} onChange={field.onChange} />
              <p className="text-[10px] text-muted-foreground">
                {tf("roleHint")}
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <section
          aria-labelledby="invite-flow"
          className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground"
        >
          <p id="invite-flow" className="label-meta mb-1 text-[10px]">
            {tf("flowTitle")}
          </p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>{tf("flowStep1")}</li>
            <li>{tf("flowStep2")}</li>
            <li>{tf("flowStep3")}</li>
          </ol>
        </section>

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
            ) : null}
            {tf("submit")}
          </Button>
        </SheetFooter>
      </form>
    </Form>
  );
}

function ManualForm({
  onCreated,
}: {
  onCreated: (result: ManualCreatedResult) => void;
}) {
  const tf = useTranslations("settings.users.invite");
  const tm = useTranslations("settings.users.manual");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<ManualFormValues>({
    defaultValues: MANUAL_DEFAULT_VALUES,
    resolver: zodResolver(
      createUserManuallyFormSchema,
    ) as unknown as Resolver<ManualFormValues>,
  });
  const passwordMode = useWatch({
    control: form.control,
    name: "password_mode",
  });

  function onSubmit(values: ManualFormValues) {
    startTransition(async () => {
      const result = await createUserManuallyAction({
        email: values.email,
        full_name: values.full_name,
        role: values.role,
        password:
          values.password_mode === "custom" ? values.password : undefined,
      });
      if (result.ok) {
        form.reset(MANUAL_DEFAULT_VALUES);
        onCreated({
          email: result.data.email,
          full_name: result.data.full_name,
          temporary_password: result.data.temporary_password,
          password_auto_generated: result.data.password_auto_generated,
          login_url: `${window.location.origin}/login`,
        });
      } else {
        toast.error(result.reason);
      }
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-1 flex-col gap-4"
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tf("email")}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  autoComplete="off"
                  placeholder={tf("emailPlaceholder")}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="full_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tf("fullName")}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete="off"
                  placeholder={tf("fullNamePlaceholder")}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tm("role")}</FormLabel>
              <RoleSelect value={field.value} onChange={field.onChange} />
              <p className="text-[10px] text-muted-foreground">
                {tm("roleHint")}
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password_mode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tm("passwordMode")}</FormLabel>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={field.value === "auto" ? "default" : "ghost"}
                  aria-pressed={field.value === "auto"}
                  onClick={() => field.onChange("auto")}
                >
                  {tm("autoGenerate")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={field.value === "custom" ? "default" : "ghost"}
                  aria-pressed={field.value === "custom"}
                  onClick={() => field.onChange("custom")}
                >
                  {tm("customPassword")}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {passwordMode === "auto"
                  ? tm("autoHint")
                  : tm("customHint")}
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        {passwordMode === "custom" ? (
          <>
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tm("password")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="new-password"
                      placeholder={tm("passwordPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password_confirmation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tm("confirmPassword")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="new-password"
                      placeholder={tm("confirmPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        ) : null}

        <section
          aria-labelledby="manual-flow"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-muted-foreground"
        >
          <p id="manual-flow" className="label-meta mb-1 text-[10px]">
            {tm("flowTitle")}
          </p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>{tm("flowStep1")}</li>
            <li>{tm("flowStep2")}</li>
            <li>{tm("flowStep3")}</li>
          </ol>
        </section>

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
            ) : null}
            {tm("submit")}
          </Button>
        </SheetFooter>
      </form>
    </Form>
  );
}

function ManualCredentialPanel({
  result,
  onDone,
}: {
  result: ManualCreatedResult;
  onDone: () => void;
}) {
  const tm = useTranslations("settings.users.manual");
  const [copied, setCopied] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(true);
  const [acknowledged, setAcknowledged] = React.useState(false);

  async function copyCredentials() {
    const text = [
      `${tm("loginUrl")}: ${result.login_url}`,
      `${tm("email")}: ${result.email}`,
      `${tm("passwordLabel")}: ${result.temporary_password}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(tm("copyFailed"));
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
      <section className="rounded-xl border border-border/60 bg-muted/30 p-4">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="label-meta text-[10px]">{tm("loginUrl")}</dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {result.login_url}
            </dd>
          </div>
          <div>
            <dt className="label-meta text-[10px]">{tm("email")}</dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {result.email}
            </dd>
          </div>
          <div>
            <dt className="label-meta text-[10px]">
              {tm("passwordLabel")}
              {result.password_auto_generated
                ? ` (${tm("autoGeneratedBadge")})`
                : ""}
            </dt>
            <dd className="mt-1 flex items-center gap-2">
              <code className="flex-1 break-all rounded-md bg-background px-2 py-1.5 font-mono text-xs">
                {showPassword ? result.temporary_password : "••••••••••••"}
              </code>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={showPassword ? tm("hidePassword") : tm("showPassword")}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </dd>
          </div>
        </dl>
      </section>

      <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-muted-foreground">
        {tm("successWarning")}
      </p>
      <p className="text-xs text-muted-foreground">
        {tm("changePasswordHint")}
      </p>

      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span>{tm("acknowledge")}</span>
      </label>

      <SheetFooter className="mt-auto flex-row justify-end gap-2 px-0">
        <Button type="button" variant="outline" onClick={copyCredentials}>
          {copied ? (
            <Check className="mr-2 size-4" />
          ) : (
            <Copy className="mr-2 size-4" />
          )}
          {copied ? tm("copied") : tm("copyCredentials")}
        </Button>
        <Button type="button" disabled={!acknowledged} onClick={onDone}>
          {tm("done")}
        </Button>
      </SheetFooter>
    </div>
  );
}
