"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Kpi } from "@/app/(app)/dashboard/actions";

const TREND_META: Record<
  Kpi["trend"],
  { icon: React.ComponentType<{ className?: string }>; className: string; label: string }
> = {
  up: { icon: ArrowUpRight, className: "text-success", label: "Up" },
  down: { icon: ArrowDownRight, className: "text-destructive", label: "Down" },
  flat: { icon: Minus, className: "text-muted-foreground", label: "Flat" },
};

export function KpiCard({ kpi, index = 0 }: { kpi: Kpi; index?: number }) {
  const trend = TREND_META[kpi.trend];
  const TrendIcon = trend.icon;
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.32, ease: "easeOut" }}
      whileHover={reduceMotion ? undefined : { y: -2, scale: 1.01 }}
    >
      <Card className="glass overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="label-meta text-muted-foreground">
            {kpi.label}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="font-display text-3xl font-semibold tracking-tight">
                {kpi.formatted}
              </div>
              <div
                className={cn(
                  "mt-1 inline-flex items-center gap-1 text-xs font-medium",
                  trend.className,
                )}
                aria-label={`${trend.label} ${Math.abs(kpi.delta).toFixed(1)}%`}
              >
                <TrendIcon className="size-3.5" />
                {kpi.delta.toFixed(1)}%
                <span className="text-muted-foreground">vs last period</span>
              </div>
            </div>

            <div className="h-12 w-24 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={kpi.sparkline}>
                  <defs>
                    <linearGradient
                      id={`gradient-${kpi.id}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="var(--color-primary)"
                        stopOpacity={0.5}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--color-primary)"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="var(--color-primary)"
                    strokeWidth={1.5}
                    fill={`url(#gradient-${kpi.id})`}
                    isAnimationActive={false}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
