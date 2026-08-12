"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  createWorkspaceSchema,
  type CreateWorkspaceInput,
} from "@/lib/validation/tenant";
import { createWorkspace } from "./actions";

export function RegisterForm() {
  const [error, setError] = React.useState<string | undefined>();
  const [isPending, startTransition] = React.useTransition();
  const t = useTranslations("auth");
  const tf = useTranslations("auth.registerForm");
  const reduceMotion = useReducedMotion();

  const form = useForm<CreateWorkspaceInput>({
    resolver: zodResolver(createWorkspaceSchema),
    defaultValues: {
      workspaceName: "",
      workspaceSlug: "",
      fullName: "",
      email: "",
      password: "",
    },
  });

  function onSubmit(values: CreateWorkspaceInput) {
    setError(undefined);
    startTransition(async () => {
      const result = await createWorkspace(values);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      toast.success(t("workspaceReady", { slug: result.slug }));
      window.location.href = result.loginUrl;
    });
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="space-y-5"
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="workspaceName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tf("workspaceName")}</FormLabel>
                <FormControl>
                  <Input placeholder={tf("workspaceNamePlaceholder")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="workspaceSlug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tf("workspaceUrl")}</FormLabel>
                <FormControl>
                  <div className="flex items-stretch overflow-hidden rounded-lg border border-input focus-within:ring-3 focus-within:ring-ring/50 focus-within:border-ring">
                    <Input
                      placeholder={tf("workspaceUrlPlaceholder")}
                      className="border-0 rounded-none focus-visible:ring-0"
                      {...field}
                    />
                    <span className="grid place-items-center bg-muted px-3 text-sm text-muted-foreground">
                      .controldesk.app
                    </span>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("fullName")}</FormLabel>
                  <FormControl>
                    <Input placeholder={tf("fullNamePlaceholder")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("email")}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder={tf("emailPlaceholderRegister")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("password")}</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder={tf("passwordMinLength")}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isPending}
          >
            {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {tf("submit")}
          </Button>
        </form>
      </Form>
    </motion.div>
  );
}
