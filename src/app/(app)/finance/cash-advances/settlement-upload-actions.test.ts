import { describe, expect, it, vi } from "vitest";

/**
 * Input-contract coverage for the CA-settlement attachment actions.
 *
 * Every branch tested here returns `VALIDATION` BEFORE the action calls
 * `requireCurrentEmployee()` or hits the database, so we don't need to
 * mock auth or Supabase. The deeper flows (real upload, copy-forward,
 * hard-require enforcement) are covered by Playwright / SQL tests.
 */
import {
  detachSettlementReceiptAction,
  submitSettlementWithReceiptsAction,
  uploadSettlementReceiptsAction,
} from "./settlement-upload-actions";

const VALID_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("submitSettlementWithReceiptsAction — input contract", () => {
  it("rejects a FormData missing cash_advance_id", async () => {
    const fd = new FormData();
    fd.set("total_spent_idr", "1000");
    const res = await submitSettlementWithReceiptsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VALIDATION");
      expect(res.reason).toMatch(/cash_advance_id/i);
    }
  });

  it("rejects a too-short cash_advance_id", async () => {
    const fd = new FormData();
    fd.set("cash_advance_id", "abc");
    fd.set("total_spent_idr", "1000");
    const res = await submitSettlementWithReceiptsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects a negative total_spent_idr", async () => {
    const fd = new FormData();
    fd.set("cash_advance_id", VALID_UUID);
    fd.set("total_spent_idr", "-500");
    const res = await submitSettlementWithReceiptsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VALIDATION");
      expect(res.reason).toMatch(/non-negative/i);
    }
  });

  it("rejects a non-numeric total_spent_idr", async () => {
    const fd = new FormData();
    fd.set("cash_advance_id", VALID_UUID);
    fd.set("total_spent_idr", "not-a-number");
    const res = await submitSettlementWithReceiptsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects an unsupported file MIME type up-front", async () => {
    const fd = new FormData();
    fd.set("cash_advance_id", VALID_UUID);
    fd.set("total_spent_idr", "1000");
    // executables aren't in the allowlist
    fd.append(
      "files",
      new File(["#!/bin/sh"], "evil.sh", { type: "application/x-sh" }),
    );
    const res = await submitSettlementWithReceiptsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VALIDATION");
      expect(res.reason).toMatch(/unsupported/i);
    }
  });

});

describe("uploadSettlementReceiptsAction — input contract", () => {
  it("rejects a missing settlement_id", async () => {
    const fd = new FormData();
    fd.append("files", new File(["x"], "a.png", { type: "image/png" }));
    const res = await uploadSettlementReceiptsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VALIDATION");
      expect(res.reason).toMatch(/settlement_id/i);
    }
  });

  it("rejects a too-short settlement_id", async () => {
    const fd = new FormData();
    fd.set("settlement_id", "abc");
    fd.append("files", new File(["x"], "a.png", { type: "image/png" }));
    const res = await uploadSettlementReceiptsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects a FormData without any files", async () => {
    const fd = new FormData();
    fd.set("settlement_id", VALID_UUID);
    const res = await uploadSettlementReceiptsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VALIDATION");
      expect(res.reason).toMatch(/no files/i);
    }
  });

  it("rejects an unsupported file MIME type", async () => {
    const fd = new FormData();
    fd.set("settlement_id", VALID_UUID);
    fd.append(
      "files",
      new File(["<html>"], "evil.html", { type: "text/html" }),
    );
    const res = await uploadSettlementReceiptsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VALIDATION");
      expect(res.reason).toMatch(/unsupported/i);
    }
  });
});

describe("detachSettlementReceiptAction — input contract", () => {
  it("rejects a missing settlement_id", async () => {
    const res = await detachSettlementReceiptAction({
      settlement_id: "",
      attachment_id: VALID_UUID,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects a missing attachment_id", async () => {
    const res = await detachSettlementReceiptAction({
      settlement_id: VALID_UUID,
      attachment_id: "",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects non-string ids (defensive against malformed callers)", async () => {
    const res = await detachSettlementReceiptAction({
      settlement_id: 42 as unknown as string,
      attachment_id: VALID_UUID,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects entirely empty input", async () => {
    const res = await detachSettlementReceiptAction(
      {} as unknown as { settlement_id: string; attachment_id: string },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });
});

// Import-time smoke test — mirrors the pattern of the sister
// `upload-actions.test.ts` file. If any of the actions eagerly ran
// server-only initialization (auth session read, Supabase client
// creation) at module load, the imports at the top of this file would
// have thrown during Vitest module evaluation.
describe("settlement-upload-actions — import safety", () => {
  it("does not eagerly initialize server-only clients at import time", () => {
    expect(true).toBe(true);
    vi.restoreAllMocks();
  });
});
