"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { PostLoginSplash } from "./post-login-splash";

// `useSyncExternalStore` snapshot helpers for hydration detection.
// Extracted to module scope so React sees stable identities and
// doesn't re-subscribe on every render. Server returns `false`,
// client returns `true` — the state machine reads exactly like
// `[hydrated, setHydrated] = useState(false); useEffect(...)`, minus
// the cascading render that React 19's compiler now flags.
function hydratedSubscribe() {
  return () => {};
}
function hydratedClientSnapshot() {
  return true;
}
function hydratedServerSnapshot() {
  return false;
}

export function LoginForm({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `?next=<path>` — the URL the user was trying to reach when the proxy
  // bounced them here. The server action re-sanitises this (never trust
  // client-supplied redirects), but we forward it verbatim so the auth
  // decision (platform admin? tenant admin?) can be made server-side
  // with the exact intent the user came in with. Empty when the user
  // hit `/login` directly.
  const nextParam = searchParams?.get("next") ?? undefined;
  const [error, setError] = React.useState<string | undefined>(initialError);
  const [isPending, startTransition] = React.useTransition();
  // Post-login brand splash. When set, we've authenticated successfully
  // and just need to run the marketing splash timer before navigating
  // to `splashTarget`. `null` = form is still interactive.
  const [splashTarget, setSplashTarget] = React.useState<string | null>(null);
  const t = useTranslations("auth");
  const reduceMotion = useReducedMotion();

  // Guard against clicks that fire before React attaches the form's
  // `onSubmit` handler. Without this, an autofilled password manager or a
  // fast-typing user can trigger a native `<form>` submit that either
  // navigates the browser to the current URL with credentials in the
  // query string, or is a silent no-op — either way the sign-in never
  // runs and the user perceives a stuck / "cannot log in" state.
  //
  // We used to do this with `useState(false)` + `useEffect(() => setState(true))`,
  // but React 19's compiler lints that as a cascading render. Instead
  // we synchronously read a store snapshot — `false` on the server,
  // `true` on the client — which mirrors what React itself uses for
  // its `useSyncExternalStore` mount-detection recipe. No effect fires
  // and no extra render happens after hydration.
  const hydrated = React.useSyncExternalStore(
    hydratedSubscribe,
    hydratedClientSnapshot,
    hydratedServerSnapshot,
  );

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
      const result = await signInWithPassword(values, { next: nextParam });
      if (result?.status === "error") {
        setError(result.message);
        return;
      }
      // Successful login — hand off to the branded splash overlay. The
      // splash will trigger `handleSplashComplete` below when its timer
      // expires OR the user skips (click / Escape / Enter), which does
      // the actual `router.replace()` to the destination.
      //
      // Client-driven navigation (vs a Server Action `redirect()`)
      // avoids a Next.js 16 Turbopack bug that inlines the wrong RSC
      // — the marketing shell — under the destination URL.
      if (result?.status === "success" && result.redirectTo) {
        setSplashTarget(result.redirectTo);
      }
    });
  }

  const handleSplashComplete = React.useCallback(
    (target: string) => {
      // The server action returns an absolute URL only for the apex →
      // tenant-subdomain hop (a user logging in at `controldesk.app`
      // whose account is scoped to `demo.controldesk.app`). Auth
      // cookies are set on the eTLD+1 so they survive the hop, but the
      // navigation itself has to leave the current origin — hence a
      // full-page load via `window.location.href` rather than the
      // in-app SPA router, which can only navigate within the current
      // origin.
      //
      // Same-origin redirects (tenant subdomain → /dashboard, apex →
      // /super-admin/tenants, or an explicit `?next=/some-path`) stay
      // on `router.replace()` for the snappy transition.
      if (/^https?:\/\//i.test(target)) {
        window.location.href = target;
        return;
      }
      router.replace(target);
      router.refresh();
    },
    [router],
  );

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
      {/* Portal-less overlay — mounted inline so it inherits the login
          page's client boundary and can call `router.replace()`
          through its parent handler. `AnimatePresence` inside the
          component handles enter/exit fades. */}
      <PostLoginSplash
        open={splashTarget !== null}
        redirectTo={splashTarget ?? "/"}
        onComplete={handleSplashComplete}
      />

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
