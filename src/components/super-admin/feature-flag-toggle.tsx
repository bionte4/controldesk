"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { toggleFeatureFlagAction } from "@/app/(super-admin)/super-admin/actions";
import type { FeatureKey } from "@/lib/ops/feature-flags";

type Props = {
  tenantId: string;
  featureKey: FeatureKey;
  enabled: boolean;
};

export function FeatureFlagToggle({ tenantId, featureKey, enabled }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOn = optimistic ?? enabled;

  const handleToggle = () => {
    const next = !isOn;
    setOptimistic(next);
    setError(null);
    startTransition(async () => {
      const res = await toggleFeatureFlagAction({
        tenant_id: tenantId,
        feature_key: featureKey,
        enabled: next,
      });
      if (!res.ok) {
        setOptimistic(!next);
        setError(res.reason);
        return;
      }
      router.refresh();
      setOptimistic(null);
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={`Toggle ${featureKey}`}
        disabled={isPending}
        onClick={handleToggle}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 ${
          isOn ? "bg-indigo-600" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
            isOn ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
      {error && (
        <span className="text-[10px] text-rose-600 dark:text-rose-400">
          {error}
        </span>
      )}
    </div>
  );
}
