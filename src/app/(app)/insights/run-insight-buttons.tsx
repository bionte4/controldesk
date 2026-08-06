"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { AiInsightKind } from "@/types/database";

import { runAllInsightsAction, runInsightAction } from "./actions";

export function RunAllInsightsButton() {
  const t = useTranslations("insights.actions");
  const [isPending, startTransition] = React.useTransition();

  function onClick() {
    startTransition(async () => {
      const res = await runAllInsightsAction({});
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      if (res.data.errors.length > 0) {
        toast.warning(
          t("partialSuccess", {
            ok: res.data.ok_count,
            fail: res.data.errors.length,
          }),
        );
      } else {
        toast.success(t("runAllOk", { count: res.data.ok_count }));
      }
    });
  }

  return (
    <Button onClick={onClick} disabled={isPending}>
      {isPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Sparkles className="size-4" />
      )}
      {t("runAll")}
    </Button>
  );
}

export function RunOneInsightButton({ kind }: { kind: AiInsightKind }) {
  const t = useTranslations("insights.actions");
  const [isPending, startTransition] = React.useTransition();

  function onClick() {
    startTransition(async () => {
      const res = await runInsightAction({ kind });
      if (res.ok) {
        toast.success(t("ranOne"));
      } else {
        toast.error(res.reason);
      }
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      disabled={isPending}
    >
      {isPending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Zap className="size-3" />
      )}
      {t("runThis")}
    </Button>
  );
}
