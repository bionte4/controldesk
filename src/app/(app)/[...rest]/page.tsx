import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Hammer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Coming soon",
};

export default async function ComingSoonPage({
  params,
}: {
  params: Promise<{ rest: string | string[] }>;
}) {
  const { rest } = await params;
  const t = await getTranslations("comingSoon");
  const segments = Array.isArray(rest) ? rest : [rest].filter(Boolean);
  const label = segments
    .map((s) => s.replace(/-/g, " "))
    .join(" › ")
    .replace(/(^\w|\s\w)/g, (m) => m.toUpperCase());

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center gap-6 py-16">
      <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Hammer className="size-6" />
      </div>
      <Card className="glass w-full">
        <CardHeader>
          <CardTitle className="font-display text-2xl">
            {label ? t("title", { module: label }) : t("titleFallback")}
          </CardTitle>
          <CardDescription>{t("body")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/dashboard" />}
          >
            <ArrowLeft className="size-3.5" /> {t("backToDashboard")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
