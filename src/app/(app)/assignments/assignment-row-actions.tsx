"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { endAssignmentAction } from "./actions";

type Translator = (key: string, values?: Record<string, string | number>) => string;

export function EndAssignmentButton({
  id,
  kind,
  disabled,
}: {
  id: string;
  kind: "pm" | "member";
  disabled?: boolean;
}) {
  const t = useTranslations("assignments") as unknown as Translator;
  const [isPending, startTransition] = React.useTransition();

  const onEnd = () => {
    if (typeof window !== "undefined" && !window.confirm(t("actions.confirmEnd"))) {
      return;
    }
    startTransition(async () => {
      const res = await endAssignmentAction({ id, kind });
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      toast.success(t("actions.endedToast"));
    });
  };

  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={onEnd}
      disabled={isPending || disabled}
      aria-label={t("actions.end")}
      title={t("actions.end")}
      className="text-muted-foreground hover:text-destructive"
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Check className="size-4" />
      )}
    </Button>
  );
}
