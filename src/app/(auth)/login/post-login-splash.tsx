"use client";

/**
 * Post-login brand splash — v2 "enterprise console" aesthetic.
 *
 * A 2.5-second welcome moment after successful sign-in that renders:
 *
 *   • A deep multi-stop gradient backdrop (indigo → violet → black)
 *     with a very subtle mesh grid pattern overlaid — evokes a "control
 *     room" console rather than a marketing splash.
 *   • Three concentric orbital rings around the brand mark, each
 *     rotating counter-clockwise at a different speed (4 / 6 / 10 s)
 *     so the composition never repeats a static frame. Each ring
 *     carries a bright accent dot at 12 o'clock, giving the illusion
 *     of "signal orbits".
 *   • A radar-style pulse ring that expands and fades every 2 s,
 *     reinforcing the "system is coming online" feel.
 *   • The existing `controldesk-logo-mark.png` sits in the center,
 *     preserved as-is so the splash never drifts from brand guidelines.
 *   • A large gradient wordmark "ControlDesk" below the mark, in
 *     Inter / display font at the size of a hero headline.
 *   • Tagline + copyright + skip hint stacked with staggered fade-ins.
 *   • Four corner brackets that hint at a "framed console viewport" —
 *     the kind of decoration real telemetry / SCADA UIs use.
 *
 * Interaction & accessibility (rules §23 — WCAG 2.2 AAA):
 *
 *   • `role="dialog"` + `aria-modal="true"` + `aria-label` announce
 *     the overlay to screen readers.
 *   • `aria-live="polite"` on the tagline so the marketing line is
 *     read once without interrupting other announcements.
 *   • Every motion respects `useReducedMotion()`: orbits stop, pulses
 *     stop, only opacity fade-ins remain. Users with vestibular
 *     sensitivity still get a static welcome — the timer + skip both
 *     work identically.
 *   • Keyboard: Escape / Enter both fast-forward the splash.
 *   • The entire overlay is `onClick={finish}` so a single tap
 *     anywhere dismisses.
 *
 * Data flow: parent (`LoginForm`) sets `open={true}` after
 * `signInWithPassword` returns success; `onComplete(redirectTo)`
 * fires when the timer elapses OR the user skips. The parent then
 * calls `router.replace()`. Nothing here calls the router directly —
 * keeps the component reusable for any future post-action splash.
 */

import { useCallback, useEffect } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const SPLASH_DURATION_MS = 2500;
const TAGLINE = "Simplify Operations. Amplify Decisions.";
const COPYRIGHT_LINE = "© 2026 RoughTechnology. All rights reserved.";
const WORDMARK = "ControlDesk";

// Orbital rings — size, rotation duration, phase offset. Sizes are in
// Tailwind arbitrary values (px) because rings live inside a fixed-size
// centering box. Speeds are deliberately non-harmonic so the orbits
// never line up into a static frame.
const ORBITS = [
  { size: 220, duration: 10, opacity: 0.35, dotColor: "bg-indigo-300" },
  { size: 280, duration: 6, opacity: 0.25, dotColor: "bg-violet-300" },
  { size: 340, duration: 14, opacity: 0.18, dotColor: "bg-sky-300" },
] as const;

// Small constellation dots that drift subtly. Positions are relative
// to the viewport (percentage) so they scale on any screen. Kept off
// the center so they don't collide with the logo cluster.
const CONSTELLATION = [
  { x: "12%", y: "20%", size: 3, delay: 0 },
  { x: "88%", y: "18%", size: 2, delay: 0.5 },
  { x: "8%", y: "72%", size: 4, delay: 1.0 },
  { x: "92%", y: "78%", size: 3, delay: 0.3 },
  { x: "24%", y: "88%", size: 2, delay: 0.8 },
  { x: "76%", y: "12%", size: 2, delay: 1.2 },
  { x: "50%", y: "8%", size: 3, delay: 0.6 },
  { x: "50%", y: "92%", size: 2, delay: 1.4 },
] as const;

export function PostLoginSplash({
  open,
  redirectTo,
  onComplete,
}: {
  open: boolean;
  redirectTo: string;
  onComplete: (target: string) => void;
}) {
  const reduceMotion = useReducedMotion();

  const finish = useCallback(() => {
    onComplete(redirectTo);
  }, [onComplete, redirectTo]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(finish, SPLASH_DURATION_MS);
    return () => clearTimeout(t);
  }, [open, finish]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Welcome to ControlDesk"
          className="fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center overflow-hidden"
          onClick={finish}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        >
          {/* Deep gradient backdrop — three-stop for depth. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(76,29,149,0.55),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(30,27,75,0.6),transparent_60%),linear-gradient(180deg,#020617_0%,#0b0b1a_50%,#000000_100%)]"
          />

          {/* Subtle mesh grid — the "console viewport" feel. */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
              maskImage:
                "radial-gradient(ellipse at center, black 30%, transparent 75%)",
              WebkitMaskImage:
                "radial-gradient(ellipse at center, black 30%, transparent 75%)",
            }}
          />

          {/* Central radial glow behind the emblem — makes the mark
              feel like it's emitting light rather than sitting on it. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.28),transparent_45%)]"
          />

          {/* Constellation dots — subtle floating stars. */}
          {!reduceMotion &&
            CONSTELLATION.map((c, i) => (
              <motion.div
                key={i}
                aria-hidden
                className="absolute rounded-full bg-white/60 shadow-[0_0_8px_rgba(255,255,255,0.4)]"
                style={{
                  left: c.x,
                  top: c.y,
                  width: c.size,
                  height: c.size,
                }}
                initial={{ opacity: 0 }}
                animate={{
                  opacity: [0, 1, 0.4, 1, 0.2],
                  y: [0, -4, 0, 2, 0],
                }}
                transition={{
                  duration: 3.5,
                  delay: c.delay,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            ))}

          {/* Corner brackets — telemetry-console framing. */}
          {[
            "top-8 left-8 border-t border-l",
            "top-8 right-8 border-t border-r",
            "bottom-24 left-8 border-b border-l",
            "bottom-24 right-8 border-b border-r",
          ].map((pos, i) => (
            <motion.div
              key={i}
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              transition={{ delay: 0.2 + i * 0.05, duration: 0.6 }}
              className={`absolute h-6 w-6 border-indigo-300/50 ${pos}`}
            />
          ))}

          {/* Central emblem cluster: orbits + pulse + logo. */}
          <div
            aria-hidden
            className="relative flex items-center justify-center"
            style={{ width: 340, height: 340 }}
          >
            {/* Radar pulse — expands outward and fades. */}
            {!reduceMotion && (
              <>
                <motion.div
                  className="absolute rounded-full border border-indigo-400/40"
                  style={{ width: 140, height: 140 }}
                  animate={{
                    scale: [1, 2.2],
                    opacity: [0.7, 0],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeOut",
                  }}
                />
                <motion.div
                  className="absolute rounded-full border border-violet-400/40"
                  style={{ width: 140, height: 140 }}
                  animate={{
                    scale: [1, 2.2],
                    opacity: [0.7, 0],
                  }}
                  transition={{
                    duration: 2,
                    delay: 1,
                    repeat: Infinity,
                    ease: "easeOut",
                  }}
                />
              </>
            )}

            {/* Orbital rings — rotate at different speeds. */}
            {ORBITS.map((orbit, i) => (
              <motion.div
                key={i}
                className="absolute rounded-full border border-white/20"
                style={{
                  width: orbit.size,
                  height: orbit.size,
                  opacity: orbit.opacity,
                  borderStyle: i === 1 ? "dashed" : "solid",
                }}
                animate={reduceMotion ? undefined : { rotate: -360 }}
                transition={
                  reduceMotion
                    ? undefined
                    : {
                        duration: orbit.duration,
                        repeat: Infinity,
                        ease: "linear",
                      }
                }
              >
                {/* Accent dot riding the ring at 12 o'clock. */}
                <div
                  className={`absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${orbit.dotColor} shadow-[0_0_10px_currentColor]`}
                />
              </motion.div>
            ))}

            {/* Logo — GENTLE scale pulse only. No spin (the orbits
                do the "motion" work; the mark stays legible). */}
            <motion.div
              className="relative h-24 w-24 drop-shadow-[0_0_50px_rgba(139,92,246,0.6)]"
              animate={
                reduceMotion
                  ? undefined
                  : {
                      scale: [1, 1.06, 1],
                    }
              }
              transition={
                reduceMotion
                  ? undefined
                  : {
                      duration: 2.4,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }
              }
            >
              <Image
                src="/brand/controldesk-logo-mark-transparent.png"
                alt=""
                width={96}
                height={96}
                priority
                className="h-full w-full object-contain"
              />
            </motion.div>
          </div>

          {/* Wordmark — gradient text below the emblem. */}
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: reduceMotion ? 0.1 : 0.35,
              duration: 0.7,
              ease: "easeOut",
            }}
            className="mt-6 bg-gradient-to-r from-indigo-200 via-violet-200 to-sky-200 bg-clip-text text-4xl font-semibold tracking-[0.02em] text-transparent sm:text-5xl md:text-6xl"
            style={{ fontFamily: "var(--font-display, ui-sans-serif)" }}
          >
            {WORDMARK}
          </motion.h1>

          {/* Tagline — smaller, muted. */}
          <motion.p
            aria-live="polite"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: reduceMotion ? 0.2 : 0.7,
              duration: 0.7,
              ease: "easeOut",
            }}
            className="mt-4 max-w-2xl px-6 text-center text-sm font-medium uppercase tracking-[0.25em] text-zinc-300/90 sm:text-base"
          >
            {TAGLINE}
          </motion.p>

          {/* Bottom stack: copyright + skip hint. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              delay: reduceMotion ? 0.3 : 1.0,
              duration: 0.7,
              ease: "easeOut",
            }}
            className="absolute bottom-10 flex flex-col items-center gap-2 text-center"
          >
            <div className="text-xs text-zinc-300/70">{COPYRIGHT_LINE}</div>
            <div className="text-[10px] font-medium uppercase tracking-[0.35em] text-zinc-500">
              Click anywhere · Press Esc to continue
            </div>
          </motion.div>

          {/* Progress bar — indigo→violet fill over the splash window. */}
          {!reduceMotion && (
            <motion.div
              aria-hidden
              className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-400 shadow-[0_0_12px_rgba(139,92,246,0.7)]"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: SPLASH_DURATION_MS / 1000, ease: "linear" }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
