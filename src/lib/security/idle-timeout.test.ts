import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resolveIdleTimeoutMinutes,
  resolveIdleWarningMinutes,
} from "./idle-timeout";

/**
 * env-var driven config should be resilient to garbage input (someone
 * accidentally sets `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES=` or `=abc` or
 * `=-30`) — we clamp everything to sane defaults instead of exploding.
 *
 * `process.env` is mutable in vitest — save/restore the two keys we care
 * about between assertions so tests are independent.
 */
describe("resolveIdleTimeoutMinutes / resolveIdleWarningMinutes", () => {
  const originalTimeout = process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES;
  const originalWarning = process.env.NEXT_PUBLIC_IDLE_WARNING_MINUTES;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES;
    delete process.env.NEXT_PUBLIC_IDLE_WARNING_MINUTES;
  });

  afterEach(() => {
    if (originalTimeout === undefined) {
      delete process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES;
    } else {
      process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES = originalTimeout;
    }
    if (originalWarning === undefined) {
      delete process.env.NEXT_PUBLIC_IDLE_WARNING_MINUTES;
    } else {
      process.env.NEXT_PUBLIC_IDLE_WARNING_MINUTES = originalWarning;
    }
  });

  it("defaults to 30 min timeout when env is unset", () => {
    expect(resolveIdleTimeoutMinutes()).toBe(30);
  });

  it("defaults to 2 min warning when env is unset", () => {
    expect(resolveIdleWarningMinutes()).toBe(2);
  });

  it("respects a valid timeout override", () => {
    process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES = "15";
    expect(resolveIdleTimeoutMinutes()).toBe(15);
  });

  it("respects a valid warning override", () => {
    process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES = "10";
    process.env.NEXT_PUBLIC_IDLE_WARNING_MINUTES = "3";
    expect(resolveIdleWarningMinutes()).toBe(3);
  });

  it("clamps timeout to the [1, 1440] range", () => {
    process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES = "9999";
    expect(resolveIdleTimeoutMinutes()).toBe(1440);
  });

  it("falls back to default on non-numeric timeout", () => {
    process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES = "not-a-number";
    expect(resolveIdleTimeoutMinutes()).toBe(30);
  });

  it("falls back to default on negative timeout", () => {
    process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES = "-15";
    expect(resolveIdleTimeoutMinutes()).toBe(30);
  });

  it("falls back to default on zero timeout", () => {
    process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES = "0";
    expect(resolveIdleTimeoutMinutes()).toBe(30);
  });

  it("clamps warning to be strictly less than timeout", () => {
    process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES = "5";
    process.env.NEXT_PUBLIC_IDLE_WARNING_MINUTES = "10";
    // 10 >= 5, must clamp to (5 - 1) = 4
    expect(resolveIdleWarningMinutes()).toBe(4);
  });

  it("clamps warning to at least 1 minute", () => {
    process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES = "30";
    process.env.NEXT_PUBLIC_IDLE_WARNING_MINUTES = "abc";
    // Non-numeric falls back to default (2), which is < 30 → stays 2
    expect(resolveIdleWarningMinutes()).toBe(2);
  });

  it("handles equal timeout and warning by shrinking warning", () => {
    process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES = "10";
    process.env.NEXT_PUBLIC_IDLE_WARNING_MINUTES = "10";
    expect(resolveIdleWarningMinutes()).toBe(9);
  });
});
