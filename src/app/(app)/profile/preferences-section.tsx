"use client";

import * as React from "react";
import {
  Bell,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  Mail,
  MessageCircle,
  MonitorCog,
  Moon,
  Palette,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Sun,
  Unlink,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  CATEGORY_LABEL_EN,
  CHANNEL_LABEL_EN,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from "@/lib/notifications/categories";
import type { PreferencesGrid } from "@/lib/notifications/preferences";
import { PushSubscribeCard } from "@/components/pwa/push-subscribe-card";

import {
  generateTelegramLinkAction,
  generateWhatsAppLinkAction,
  restorePreferencesDefaultsAction,
  sendTelegramTestAction,
  sendWhatsAppTestAction,
  unlinkTelegramAction,
  unlinkWhatsAppAction,
  updatePreferencesAction,
} from "./actions";

type TelegramInitialState =
  | { status: "no_bot" }
  | {
      status: "unlinked";
      botUsername: string;
    }
  | {
      status: "linked";
      botUsername: string;
      displayName: string | null;
      telegramUsername: string | null;
    };

type WhatsAppInitialState =
  | { status: "no_config" }
  | {
      status: "unlinked";
      businessPhone: string;
      provider: "TWILIO" | "META_CLOUD" | "FONNTE";
    }
  | {
      status: "linked";
      businessPhone: string;
      provider: "TWILIO" | "META_CLOUD" | "FONNTE";
      displayName: string | null;
      profileName: string | null;
    };

export function PreferencesSection({
  initialGrid,
  telegram,
  whatsapp,
}: {
  initialGrid: PreferencesGrid;
  telegram: TelegramInitialState;
  whatsapp: WhatsAppInitialState;
}) {
  const t = useTranslations("profile.preferences");
  return (
    <section className="flex flex-col gap-4" aria-labelledby="prefs-heading">
      <div className="flex items-center gap-2">
        <Sparkles className="size-5 text-primary" aria-hidden />
        <div>
          <h2
            id="prefs-heading"
            className="font-display text-2xl font-semibold tracking-tight"
          >
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>
      <NotificationsCard initialGrid={initialGrid} />
      <PushSubscribeCard />
      <TelegramCard telegram={telegram} />
      <WhatsAppCard whatsapp={whatsapp} />
      <AppearanceCard />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function NotificationsCard({ initialGrid }: { initialGrid: PreferencesGrid }) {
  const t = useTranslations("profile.preferences");
  const tCat = useTranslations("profile.preferences.categories");
  const tCh = useTranslations("profile.preferences.channels");
  const tDesc = useTranslations("profile.preferences.categoryDescription");

  const [grid, setGrid] = React.useState<PreferencesGrid>(initialGrid);
  const [dirty, setDirty] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function toggle(cat: NotificationCategory, ch: NotificationChannel) {
    setGrid((prev) => ({
      ...prev,
      [cat]: { ...prev[cat], [ch]: !prev[cat][ch] },
    }));
    setDirty(true);
  }

  function onSave() {
    const toggles: {
      category: NotificationCategory;
      channel: NotificationChannel;
      enabled: boolean;
    }[] = [];
    for (const cat of NOTIFICATION_CATEGORIES) {
      for (const ch of NOTIFICATION_CHANNELS) {
        toggles.push({ category: cat, channel: ch, enabled: grid[cat][ch] });
      }
    }
    startTransition(async () => {
      const res = await updatePreferencesAction({ toggles });
      if (!res.ok) {
        toast.error(res.reason ?? t("toast.saveError"));
        return;
      }
      setDirty(false);
      toast.success(t("toast.saveOk"));
    });
  }

  function onRestore() {
    startTransition(async () => {
      const res = await restorePreferencesDefaultsAction({ confirm: true });
      if (!res.ok) {
        toast.error(res.reason ?? t("toast.restoreError"));
        return;
      }
      // Reset UI to "all ON" baseline.
      const fresh = {} as PreferencesGrid;
      for (const cat of NOTIFICATION_CATEGORIES) {
        fresh[cat] = {} as Record<NotificationChannel, boolean>;
        for (const ch of NOTIFICATION_CHANNELS) {
          fresh[cat][ch] = true;
        }
      }
      setGrid(fresh);
      setDirty(false);
      toast.success(t("toast.restoreOk"));
    });
  }

  return (
    <Card className="glass">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bell className="size-4" aria-hidden />
            {t("notifications.title")}
          </CardTitle>
          <CardDescription>{t("notifications.description")}</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRestore}
          disabled={pending}
          aria-label={t("actions.restore")}
        >
          {pending ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="mr-1 size-3.5" aria-hidden />
          )}
          {t("actions.restore")}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="w-full overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">
                  {t("notifications.tableCategory")}
                </th>
                {NOTIFICATION_CHANNELS.map((ch) => (
                  <th
                    key={ch}
                    className="w-28 px-4 py-3 text-center font-medium"
                  >
                    <span className="inline-flex items-center justify-center gap-1">
                      {ch === "IN_APP" ? (
                        <Bell className="size-3.5" aria-hidden />
                      ) : ch === "EMAIL" ? (
                        <Mail className="size-3.5" aria-hidden />
                      ) : ch === "TELEGRAM" ? (
                        <Send className="size-3.5" aria-hidden />
                      ) : (
                        <MessageCircle className="size-3.5" aria-hidden />
                      )}
                      {safeChannelLabel(tCh, ch)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {NOTIFICATION_CATEGORIES.map((cat) => (
                <tr key={cat} className="group">
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {safeCategoryLabel(tCat, cat)}
                      </span>
                      <span className="mt-0.5 text-xs text-muted-foreground">
                        {safeCategoryDesc(tDesc, cat)}
                      </span>
                    </div>
                  </td>
                  {NOTIFICATION_CHANNELS.map((ch) => (
                    <td key={ch} className="w-28 px-4 py-3 text-center">
                      <div className="flex items-center justify-center">
                        <Switch
                          checked={grid[cat][ch]}
                          onCheckedChange={() => toggle(cat, ch)}
                          disabled={pending}
                          aria-label={`${safeCategoryLabel(tCat, cat)} — ${safeChannelLabel(tCh, ch)}`}
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-muted/20 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {t("notifications.summary", {
              count: NOTIFICATION_CATEGORIES.length,
            })}
          </p>
          <Button
            size="sm"
            onClick={onSave}
            disabled={pending || !dirty}
            aria-label={t("actions.save")}
          >
            {pending ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="mr-1 size-3.5" aria-hidden />
            )}
            {t("actions.save")}
          </Button>
        </div>
        <div className="border-t border-border/50 bg-primary/5 px-4 py-3 text-xs text-primary/90">
          <p className="flex items-start gap-2">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{t("notifications.emailHint")}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

function TelegramCard({ telegram }: { telegram: TelegramInitialState }) {
  const t = useTranslations("profile.preferences.telegram");
  const [pending, startTransition] = React.useTransition();
  const [linkUrl, setLinkUrl] = React.useState<string | null>(null);

  function onGenerateLink() {
    startTransition(async () => {
      const res = await generateTelegramLinkAction();
      if (!res.ok) {
        toast.error(res.reason ?? t("toast.linkError"));
        return;
      }
      setLinkUrl(res.data.url);
    });
  }

  function onSendTest() {
    startTransition(async () => {
      const res = await sendTelegramTestAction();
      if (!res.ok) {
        toast.error(res.reason ?? t("toast.testError"));
        return;
      }
      toast.success(t("toast.testOk"));
    });
  }

  function onUnlink() {
    startTransition(async () => {
      const res = await unlinkTelegramAction();
      if (!res.ok) {
        toast.error(res.reason ?? t("toast.unlinkError"));
        return;
      }
      toast.success(t("toast.unlinkOk"));
      setLinkUrl(null);
    });
  }

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="size-4" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {telegram.status === "no_bot" ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t("botNotConfigured")}</span>
            </p>
          </div>
        ) : telegram.status === "linked" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">
                {t("linked")}
              </Badge>
              {telegram.displayName ? (
                <span className="text-sm">
                  {t("linkedAs")}{" "}
                  <span className="font-medium">{telegram.displayName}</span>
                  {telegram.telegramUsername ? (
                    <span className="ml-1 text-muted-foreground">
                      (@{telegram.telegramUsername})
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onSendTest}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Send className="mr-1 size-3.5" aria-hidden />
                )}
                {t("sendTest")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onUnlink}
                disabled={pending}
                className="text-destructive hover:text-destructive"
              >
                <Unlink className="mr-1 size-3.5" aria-hidden />
                {t("unlink")}
              </Button>
            </div>
          </div>
        ) : (
          // status === "unlinked"
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {t("unlinkedIntro", { botUsername: telegram.botUsername })}
            </p>
            {linkUrl ? (
              <div className="rounded-md border border-border/60 bg-muted/30 p-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  {t("linkReady")}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    {t("openInTelegram")}
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(linkUrl);
                      toast.success(t("toast.copied"));
                    }}
                    aria-label={t("copy")}
                  >
                    <Copy className="mr-1 size-3.5" aria-hidden />
                    {t("copy")}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("linkExpires")}
                </p>
              </div>
            ) : null}
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={onGenerateLink}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Send className="mr-1 size-3.5" aria-hidden />
                )}
                {t("generateLink")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

function WhatsAppCard({ whatsapp }: { whatsapp: WhatsAppInitialState }) {
  const t = useTranslations("profile.preferences.whatsapp");
  const [pending, startTransition] = React.useTransition();
  const [linkUrl, setLinkUrl] = React.useState<string | null>(null);

  function onGenerateLink() {
    startTransition(async () => {
      const res = await generateWhatsAppLinkAction();
      if (!res.ok) {
        toast.error(res.reason ?? t("toast.linkError"));
        return;
      }
      setLinkUrl(res.data.url);
    });
  }

  function onSendTest() {
    startTransition(async () => {
      const res = await sendWhatsAppTestAction();
      if (!res.ok) {
        toast.error(res.reason ?? t("toast.testError"));
        return;
      }
      toast.success(t("toast.testOk"));
    });
  }

  function onUnlink() {
    startTransition(async () => {
      const res = await unlinkWhatsAppAction();
      if (!res.ok) {
        toast.error(res.reason ?? t("toast.unlinkError"));
        return;
      }
      toast.success(t("toast.unlinkOk"));
      setLinkUrl(null);
    });
  }

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="size-4" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {whatsapp.status === "no_config" ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t("notConfigured")}</span>
            </p>
          </div>
        ) : whatsapp.status === "linked" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">
                {t("linked")}
              </Badge>
              {whatsapp.displayName || whatsapp.profileName ? (
                <span className="text-sm">
                  {t("linkedAs")}{" "}
                  <span className="font-medium">
                    {whatsapp.profileName ?? whatsapp.displayName}
                  </span>
                </span>
              ) : null}
              <Badge variant="outline" className="text-xs">
                {whatsapp.provider === "TWILIO"
                  ? "Twilio"
                  : whatsapp.provider === "META_CLOUD"
                    ? "Meta"
                    : "Fonnte"}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onSendTest}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
                ) : (
                  <MessageCircle className="mr-1 size-3.5" aria-hidden />
                )}
                {t("sendTest")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onUnlink}
                disabled={pending}
                className="text-destructive hover:text-destructive"
              >
                <Unlink className="mr-1 size-3.5" aria-hidden />
                {t("unlink")}
              </Button>
            </div>
          </div>
        ) : (
          // status === "unlinked"
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {t("unlinkedIntro", {
                businessPhone: `+${whatsapp.businessPhone}`,
              })}
            </p>
            {linkUrl ? (
              <div className="rounded-md border border-border/60 bg-muted/30 p-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  {t("linkReady")}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    {t("openInWhatsApp")}
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(linkUrl);
                      toast.success(t("toast.copied"));
                    }}
                    aria-label={t("copy")}
                  >
                    <Copy className="mr-1 size-3.5" aria-hidden />
                    {t("copy")}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("linkExpires")}
                </p>
              </div>
            ) : null}
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={onGenerateLink}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
                ) : (
                  <MessageCircle className="mr-1 size-3.5" aria-hidden />
                )}
                {t("generateLink")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

function AppearanceCard() {
  const t = useTranslations("profile.preferences.appearance");
  const { theme, setTheme } = useTheme();

  // `theme` is undefined during SSR and hydrates on the client. Falling
  // back to "system" gives a stable neutral highlight; next-themes
  // suppresses the hydration mismatch for us via its own attributes.
  const activeTheme = theme ?? "system";

  const options: {
    id: "light" | "dark" | "system";
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: "light",
      label: t("light"),
      icon: <Sun className="size-3.5" aria-hidden />,
    },
    {
      id: "dark",
      label: t("dark"),
      icon: <Moon className="size-3.5" aria-hidden />,
    },
    {
      id: "system",
      label: t("system"),
      icon: <MonitorCog className="size-3.5" aria-hidden />,
    },
  ];

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-4" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          role="radiogroup"
          aria-label={t("title")}
          className="inline-flex w-fit gap-1 rounded-md border border-border/60 bg-muted/40 p-1"
        >
          {options.map((opt) => {
            const isActive = activeTheme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => setTheme(opt.id)}
                className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition ${
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.icon}
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("appliedInstantly")}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Locale-safe translation helpers — fall back to the English tuple if
// a key isn't hydrated yet (fresh dev startup + hot reload edge cases).
// ---------------------------------------------------------------------------

function safeCategoryLabel(
  t: ReturnType<typeof useTranslations>,
  cat: NotificationCategory,
): string {
  try {
    return t(cat);
  } catch {
    return CATEGORY_LABEL_EN[cat];
  }
}

function safeCategoryDesc(
  t: ReturnType<typeof useTranslations>,
  cat: NotificationCategory,
): string {
  try {
    return t(cat);
  } catch {
    return "";
  }
}

function safeChannelLabel(
  t: ReturnType<typeof useTranslations>,
  ch: NotificationChannel,
): string {
  try {
    return t(ch);
  } catch {
    return CHANNEL_LABEL_EN[ch];
  }
}
