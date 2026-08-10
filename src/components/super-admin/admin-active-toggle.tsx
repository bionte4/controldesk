"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setPlatformAdminActiveAction } from "@/app/(super-admin)/super-admin/actions";

type Props = {
  userId: string;
  email: string;
  isActive: boolean;
  isSelf: boolean;
};

export function AdminActiveToggle({ userId, email, isActive, isSelf }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Self-row: block deactivate (server also blocks). Show a plain
  // label so the row still makes sense.
  if (isSelf && isActive) {
    return (
      <span
        className="text-xs text-zinc-500 dark:text-zinc-400"
        title="Anda tidak bisa non-aktifkan akun sendiri"
      >
        (akun Anda)
      </span>
    );
  }

  const handleToggle = () => {
    if (isActive) {
      if (
        !window.confirm(
          `Nonaktifkan platform admin "${email}"? JWT claim is_platform_admin akan hilang di sesi berikutnya (setelah token refresh).`,
        )
      ) {
        return;
      }
    }
    setError(null);
    startTransition(async () => {
      const res = await setPlatformAdminActiveAction({
        user_id: userId,
        is_active: !isActive,
      });
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        className={`rounded-md px-3 py-1.5 text-xs font-medium shadow-sm disabled:opacity-60 ${
          isActive
            ? "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
            : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:hover:bg-emerald-900"
        }`}
      >
        {isPending ? "…" : isActive ? "Nonaktifkan" : "Aktifkan kembali"}
      </button>
      {error && (
        <span className="text-[10px] text-rose-600 dark:text-rose-400">
          {error}
        </span>
      )}
    </div>
  );
}
