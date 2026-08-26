import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSessionTimestamp, verifySessionTimestamp } from "./session-timeout-cookie";

describe("enterprise session timestamp", () => {
  const previous = process.env.SESSION_TIMEOUT_SECRET;

  beforeEach(() => {
    process.env.SESSION_TIMEOUT_SECRET = "test-secret-at-least-32-characters-long";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.SESSION_TIMEOUT_SECRET;
    else process.env.SESSION_TIMEOUT_SECRET = previous;
  });

  it("round-trips a signed timestamp", async () => {
    const value = await createSessionTimestamp(1_700_000_000_000);
    await expect(verifySessionTimestamp(value)).resolves.toBe(1_700_000_000_000);
  });

  it("rejects a forged later timestamp", async () => {
    const value = await createSessionTimestamp(1_700_000_000_000);
    const [, signature] = value.split(".");
    await expect(verifySessionTimestamp(`1800000000000.${signature}`)).resolves.toBeNull();
  });

  it("rejects malformed values", async () => {
    await expect(verifySessionTimestamp("not-a-cookie")).resolves.toBeNull();
    await expect(verifySessionTimestamp(undefined)).resolves.toBeNull();
  });
});
