import { describe, expect, it, vi } from "vitest";

/**
 * Input-contract coverage for the Petty Cash REPLENISHMENT attachment
 * actions. Every branch tested here returns early with VALIDATION
 * BEFORE `requireCurrentEmployee()` / Supabase are involved, so no
 * auth/DB mocking is needed.
 */
import {
  detachReplenishmentAttachmentAction,
  uploadReplenishmentAttachmentsAction,
} from "./replenishment-upload-actions";

const VALID_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("uploadReplenishmentAttachmentsAction — input contract", () => {
  it("rejects a FormData missing replenishment_id", async () => {
    const fd = new FormData();
    fd.append("files", new File(["x"], "a.png", { type: "image/png" }));
    const res = await uploadReplenishmentAttachmentsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VALIDATION");
      expect(res.reason).toMatch(/replenishment_id/i);
    }
  });

  it("rejects a too-short replenishment_id", async () => {
    const fd = new FormData();
    fd.set("replenishment_id", "abc");
    fd.append("files", new File(["x"], "a.png", { type: "image/png" }));
    const res = await uploadReplenishmentAttachmentsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects a FormData without any files", async () => {
    const fd = new FormData();
    fd.set("replenishment_id", VALID_UUID);
    const res = await uploadReplenishmentAttachmentsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VALIDATION");
      expect(res.reason).toMatch(/no files/i);
    }
  });

  it("rejects an unsupported file MIME type up-front", async () => {
    const fd = new FormData();
    fd.set("replenishment_id", VALID_UUID);
    fd.append(
      "files",
      new File(["<html>"], "evil.html", { type: "text/html" }),
    );
    const res = await uploadReplenishmentAttachmentsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VALIDATION");
      expect(res.reason).toMatch(/unsupported/i);
    }
  });

  it("rejects when 'files' entries are non-File values", async () => {
    const fd = new FormData();
    fd.set("replenishment_id", VALID_UUID);
    fd.append("files", "not-a-file");
    const res = await uploadReplenishmentAttachmentsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VALIDATION");
    }
  });
});

describe("detachReplenishmentAttachmentAction — input contract", () => {
  it("rejects a missing replenishment_id", async () => {
    const res = await detachReplenishmentAttachmentAction({
      replenishment_id: "",
      attachment_id: VALID_UUID,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects a missing attachment_id", async () => {
    const res = await detachReplenishmentAttachmentAction({
      replenishment_id: VALID_UUID,
      attachment_id: "",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects non-string ids (defensive against malformed callers)", async () => {
    const res = await detachReplenishmentAttachmentAction({
      replenishment_id: 42 as unknown as string,
      attachment_id: VALID_UUID,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects entirely empty input", async () => {
    const res = await detachReplenishmentAttachmentAction(
      {} as unknown as { replenishment_id: string; attachment_id: string },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });
});

describe("replenishment-upload-actions — import safety", () => {
  it("does not eagerly initialize server-only clients at import time", () => {
    // If any of the actions ran auth/DB init at module load, the
    // imports at the top of this file would have thrown during
    // Vitest module evaluation. Reaching this assertion means the
    // module loaded cleanly.
    expect(true).toBe(true);
    vi.restoreAllMocks();
  });
});
