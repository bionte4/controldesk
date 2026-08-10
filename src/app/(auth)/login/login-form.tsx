"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Loader2, Mail, Lock } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  loginSchema,
  magicLinkSchema,
  type LoginInput,
  type MagicLinkInput,
} from "@/lib/validation/auth";
import { sendMagicLink, signInWithPassword } from "../actions";

export function LoginForm({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | undefined>(initialError);
  const [isPending, startTransition] = React.useTransition();
  const t = useTranslations("auth");
  const reduceMotion = useReducedMotion();

  // Guard against clicks that fire before React attaches the form's
  // `onSubmit` handler. Without this, an autofilled password manager or a
  // fast-typing user can trigger a native `<form>` submit that either
  // navigates the browser to the current URL with credentials in the
  // query string, or is a silent no-op — either way the sign-in never
  // runs and the user perceives a stuck / "cannot log in" state.
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => {
    setHydrated(true);
  }, []);

  const passwordForm = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const magicForm = useForm<MagicLinkInput>({
    resolver: zodResolver(magicLinkSchema),
    defaultValues: { email: "" },
  });

  function onPasswordSubmit(values: LoginInput) {
    setError(undefined);
    startTransition(async () => {
      const result = await signInWithPassword(values);
      if (result?.status === "error") {
        setError(result.message);
        return;
      }
      // Client-driven navigation avoids a Next.js 16 bug where a Server
      // Action `redirect()` under Turbopack inlines the wrong RSC (the
      // marketing shell) and commits it under the destination URL, which
      // manifests as "dashboard URL but marketing content" until reload.
      if (result?.status === "success" && result.redirectTo) {
        router.replace(result.redirectTo);
        router.refresh();
      }
    });
  }

  function onMagicSubmit(values: MagicLinkInput) {
    setError(undefined);
    startTransition(async () => {
      const result = await sendMagicLink(values);
      if (result.status === "error") {
        setError(result.message);
      } else if (result.status === "success") {
        toast.success(result.message ?? t("magicLinkSent"));
        magicForm.reset();
      }
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

      <Tabs defaultValue="password" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="password">{t("password")}</TabsTrigger>
          <TabsTrigger value="magic">{t("magicLink")}</TabsTrigger>
        </TabsList>

        <TabsContent value="password" className="mt-5">
          <Form {...passwordForm}>
            <form
              onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
              // `method="post"` on the plain <form> so if a native submit
              // fires before React hydrates (e.g. browser autofill flow),
              // credentials aren't leaked in the URL as query params.
              method="post"
              className="space-y-4"
            >
              <FormField
                control={passwordForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("email")}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <Input
                          type="email"
                          autoComplete="email"
                          placeholder={t("emailPlaceholder")}
                          className="pl-9"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={passwordForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("password")}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <Input
                          type="password"
                          autoComplete="current-password"
                          placeholder={t("passwordPlaceholder")}
                          className="pl-9"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={isPending || !hydrated}
                aria-busy={isPending || !hydrated}
              >
                {isPending || !hydrated ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                {t("signIn")}
              </Button>
            </form>
          </Form>
        </TabsContent>

        <TabsContent value="magic" className="mt-5">
          <Form {...magicForm}>
            <form
              onSubmit={magicForm.handleSubmit(onMagicSubmit)}
              method="post"
              className="space-y-4"
            >
              <FormField
                control={magicForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("email")}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <Input
                          type="email"
                          autoComplete="email"
                          placeholder={t("emailPlaceholder")}
                          className="pl-9"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={isPending || !hydrated}
                aria-busy={isPending || !hydrated}
              >
                {isPending || !hydrated ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                {t("sendMagicLink")}
              </Button>
            </form>
          </Form>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
