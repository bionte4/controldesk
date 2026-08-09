import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * ControlDesk brand mark — three stacked, layered rounded squares
 * representing operational modules (approval, cash, HRIS, insight)
 * composed into a single control surface. See `public/brand/
 * controldesk-logo-mark.png` for the raster variant used for OG /
 * favicon; this component is the preferred handle everywhere in-app
 * because it scales cleanly and picks up the tenant theme.
 *
 * Colour ramp (indigo → violet → cyan) mirrors the primary /
 * chart-2 / chart-3 tokens in `globals.css` (rules §4). The gradient
 * IDs are suffixed with a stable id per instance so multiple `<Logo>`
 * usages on the same page don't collide when React.useId() is unavailable.
 */

type LogoProps = React.SVGProps<SVGSVGElement> & {
  /** Rendered box size in px. Defaults to 32. */
  size?: number;
  /** Wrapper radius for the surrounding box shadow (0 = flat, no glow). */
  variant?: "flat" | "elevated";
};

export function Logo({
  size = 32,
  variant = "elevated",
  className,
  ...rest
}: LogoProps) {
  const uid = React.useId().replace(/[:]/g, "");
  const gTop = `cd-logo-top-${uid}`;
  const gMid = `cd-logo-mid-${uid}`;
  const gBot = `cd-logo-bot-${uid}`;

  return (
    <svg
      role="img"
      aria-label="ControlDesk"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn(
        "shrink-0",
        variant === "elevated" &&
          "drop-shadow-[0_4px_12px_rgba(99,102,241,0.35)]",
        className,
      )}
      {...rest}
    >
      <defs>
        <linearGradient id={gTop} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
        <linearGradient id={gMid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id={gBot} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>

      {/* Bottom card — teal */}
      <rect x="34" y="38" width="52" height="52" rx="12" fill={`url(#${gBot})`} />
      {/* Middle card — violet */}
      <rect x="24" y="24" width="52" height="52" rx="12" fill={`url(#${gMid})`} />
      {/* Top card — indigo */}
      <rect x="14" y="10" width="52" height="52" rx="12" fill={`url(#${gTop})`} />
    </svg>
  );
}

/**
 * Wordmark — logo + "ControlDesk" text lockup. Use in top-bar / auth
 * headers. `size` controls the icon; the text scales with `text-lg`
 * (adjustable via the surrounding element's font-size).
 */
export function LogoLockup({
  size = 32,
  className,
  ...rest
}: LogoProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-display font-semibold",
        className,
      )}
    >
      <Logo size={size} {...rest} />
      <span>ControlDesk</span>
    </span>
  );
}
