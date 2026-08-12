"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Loader2, UserPlus } from "lucide-react";
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
  inviteUserSchema,
  type InviteUserInput,
} from "@/lib/validation/user-admin";

import { inviteUserAction } from "./actions";

const DEFAULT_VALUES: InviteUserInput = {
  email: "",
  full_name: "",
  role: "EMPLOYEE",
};

/**
 * Invite-user drawer. Only TENANT_ADMIN roles get here (server + PDP guard);
 * we still hide behind a button in the parent page so the trigger is only
 * rendered when the actor is eligible.
 *
 * On success the sheet closes and the parent page revalidates via the
 * `revalidatePath("/settings/users")` call in the server action. We show
 * the invite recipient in the success toast so the admin can double-check
 * they emailed the right person before moving on.
 */
export function InviteUserSheet() {
  const tf = useTranslations("settings.users.invite");
  const tRoles = useTranslations("settings.users.canonicalRole");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<InviteUserInput>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(inviteUserSchema) as unknown as Resolver<
      InviteUserInput
    >,
  });

  function onSubmit(values: InviteUserInput) {
    startTransition(async () => {
      const result = await inviteUserAction(values);
      if (result.ok) {
        toast.success(tf("submittedToast", { email: result.data.email }));
        form.reset(DEFAULT_VALUES);
        setOpen(false);
      } else {
        toast.error(result.reason);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
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
          <SheetTitle>{tf("title")}</SheetTitle>
          <SheetDescription>{tf("description")}</SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
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
      </SheetContent>
    </Sheet>
  );
}
