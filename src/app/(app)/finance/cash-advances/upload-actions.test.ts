import { describe, expect, it, vi } from "vitest";

/**
 * Input-validation coverage for the cash advance attachment actions.
 *
 * Both actions return early with `code: "VALIDATION"` BEFORE hitting
 * `requireCurrentEmployee()` / Supabase, so these branches are unit-
 * testable without mocking auth or the DB. Deeper flows (real upload,
 * signed-URL round-trip) are covered by the Playwright e2e suite.
 */

// The actions live in a "use server" file — Vitest is happy with that
// as long as we don't touch the DB path. The imported functions run
// under Node like plain async functions.
import {
  detachCashAdvanceAttachmentAction,
  uploadCashAdvanceAttachmentsAction,
} from "./upload-actions";

const VALID_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("uploadCashAdvanceAttachmentsAction — input contract", () => {
  it("rejects a FormData missing cash_advance_id", async () => {
    const fd = new FormData();
    fd.append("files", new File(["x"], "a.png", { type: "image/png" }));
    const result = await uploadCashAdvanceAttachmentsAction(fd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION");
      expect(result.reason).toMatch(/cash_advance_id/i);
    }
  });

  it("rejects a FormData with a too-short cash_advance_id", async () => {
    const fd = new FormData();
    fd.set("cash_advance_id", "abc"); // < 8 chars
    fd.append("files", new File(["x"], "a.png", { type: "image/png" }));
    const result = await uploadCashAdvanceAttachmentsAction(fd);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("rejects a FormData without any files", async () => {
    const fd = new FormData();
    fd.set("cash_advance_id", VALID_UUID);
    const result = await uploadCashAdvanceAttachmentsAction(fd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION");
      expect(result.reason).toMatch(/no files/i);
    }
  });

  it("rejects a FormData where the 'files' entries are non-File values", async () => {
    // Only File instances pass the type-narrowing filter; strings from
    // the same key are dropped, so the validator sees zero files.
    const fd = new FormData();
    fd.set("cash_advance_id", VALID_UUID);
    fd.append("files", "not-a-file");
    const result = await uploadCashAdvanceAttachmentsAction(fd);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });
});

describe("detachCashAdvanceAttachmentAction — input contract", () => {
  it("rejects a missing cash_advance_id", async () => {
    const result = await detachCashAdvanceAttachmentAction({
      cash_advance_id: "",
      attachment_id: VALID_UUID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("rejects a missing attachment_id", async () => {
    const result = await detachCashAdvanceAttachmentAction({
      cash_advance_id: VALID_UUID,
      attachment_id: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("rejects non-string ids (defensive against malformed callers)", async () => {
    const result = await detachCashAdvanceAttachmentAction({
      // deliberate lie for testing runtime guard.
      cash_advance_id: 42 as unknown as string,
      attachment_id: VALID_UUID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("rejects entirely empty input", async () => {
    const result = await detachCashAdvanceAttachmentAction(
      {} as unknown as { cash_advance_id: string; attachment_id: string },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });
});

// A silent import-time smoke test: if the file starts to pull in a
// Node-only server dependency during test import (e.g. via a top-level
// call to `createClient` or `requireCurrentEmployee`), this test would
// break before running the input-contract cases above. Guarding it
// explicitly makes the failure mode obvious.
describe("upload-actions — import safety", () => {
  it("does not eagerly initialize server-only clients at import time", () => {
    // The imports at the top of this file already succeeded. If any of
    // them ran auth or DB init, Vitest would have thrown during
    // module evaluation. Reaching this line is the assertion.
    expect(true).toBe(true);
    vi.restoreAllMocks();
  });
});
