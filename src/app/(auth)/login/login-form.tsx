"use client";

import * as React from "react";
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
  const [error, setError] = React.useState<string | undefined>(initialError);
  const [isPending, startTransition] = React.useTransition();
  const t = useTranslations("auth");
  const reduceMotion = useReducedMotion();

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
      if (result?.status === "error") setError(result.message);
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
                disabled={isPending}
              >
                {isPending ? (
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
                disabled={isPending}
              >
                {isPending ? (
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
