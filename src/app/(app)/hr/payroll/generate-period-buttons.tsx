"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, RefreshCcw, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";

import {
  finalizePayrollPeriodAction,
  generatePayrollPeriodAction,
} from "./actions";

export function GeneratePayrollPeriodButton({
  year,
  month,
  label,
  loadingLabel,
  successLabel,
  errorLabel,
}: {
  year: number;
  month: number;
  label: string;
  loadingLabel: string;
  successLabel: string;
  errorLabel: string;
}) {
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      onClick={() =>
        startTransition(async () => {
          const res = await generatePayrollPeriodAction({
            period_year: year,
            period_month: month,
          });
          if (res.ok) {
            toast.success(successLabel);
          } else {
            toast.error(res.reason ?? errorLabel);
          }
        })
      }
      disabled={pending}
      className="gap-2"
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          {loadingLabel}
        </>
      ) : (
        <>
          <RefreshCcw className="size-4" />
          {label}
        </>
      )}
    </Button>
  );
}

export function FinalizePeriodButton({
  id,
  label,
  successLabel,
  errorLabel,
}: {
  id: string;
  label: string;
  successLabel: string;
  errorLabel: string;
}) {
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      className="gap-1.5"
      onClick={() =>
        startTransition(async () => {
          const res = await finalizePayrollPeriodAction({ id });
          if (res.ok) toast.success(successLabel);
          else toast.error(res.reason ?? errorLabel);
        })
      }
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Lock className="size-3.5" />
      )}
      {label}
    </Button>
  );
}
