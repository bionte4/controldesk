"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

import { portalLogoutAction } from "./actions";

export function PortalSignOutButton({ label }: { label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="gap-1.5"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await portalLogoutAction();
        })
      }
      aria-label={label}
    >
      <LogOut aria-hidden="true" className="size-4" />
      <span className="hidden md:inline">{label}</span>
    </Button>
  );
}
