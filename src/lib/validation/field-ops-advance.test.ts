import { describe, expect, it } from "vitest";

import {
  deleteDraftFieldOpsSchema,
  rabLineDraftSchema,
  saveDraftFieldOpsSchema,
  submitDraftFieldOpsSchema,
  submitReadyFieldOpsSchema,
  updateDraftFieldOpsSchema,
} from "./field-ops-advance";

const VALID_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

// ---------------------------------------------------------------------------
// rabLineDraftSchema — a single RAB row.
// ---------------------------------------------------------------------------
describe("rabLineDraftSchema", () => {
  it("accepts a minimal row (category + amount)", () => {
    const parsed = rabLineDraftSchema.safeParse({
      category: "Transportasi",
      amount: 500_000,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a full row with id + seq + detail", () => {
    const parsed = rabLineDraftSchema.safeParse({
      id: VALID_UUID,
      seq: 1,
      category: "Konsumsi",
      detail: "Makan siang 3 org",
      amount: 250_000,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a zero amount (must be > 0)", () => {
    const parsed = rabLineDraftSchema.safeParse({
      category: "Transportasi",
      amount: 0,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/greater than zero/i);
    }
  });

  it("rejects a negative amount", () => {
    const parsed = rabLineDraftSchema.safeParse({
      category: "Transportasi",
      amount: -1000,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty category", () => {
    const parsed = rabLineDraftSchema.safeParse({
      category: "",
      amount: 1000,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an amount that exceeds the hard ceiling", () => {
    const parsed = rabLineDraftSchema.safeParse({
      category: "Konsumsi",
      amount: 1_000_000_000_000, // 1 trillion — > 999_999_999_999
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/maximum/i);
    }
  });

  it("rejects a non-UUID id", () => {
    const parsed = rabLineDraftSchema.safeParse({
      id: "not-a-uuid",
      category: "Konsumsi",
      amount: 1000,
    });
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// saveDraftFieldOpsSchema — permissive draft persistence.
// ---------------------------------------------------------------------------
describe("saveDraftFieldOpsSchema", () => {
  it("accepts the barest possible draft (project + ticket)", () => {
    const parsed = saveDraftFieldOpsSchema.safeParse({
      project_id: VALID_UUID,
      ticket_number: "SPK-2026-001",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rab_lines).toEqual([]);
      expect(parsed.data.pickup_key_bts).toBe(false);
    }
  });

  it("accepts an empty rab_lines array", () => {
    const parsed = saveDraftFieldOpsSchema.safeParse({
      project_id: VALID_UUID,
      ticket_number: "SPK-2026-001",
      rab_lines: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a missing project_id", () => {
    const parsed = saveDraftFieldOpsSchema.safeParse({
      ticket_number: "SPK-2026-001",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty ticket_number", () => {
    const parsed = saveDraftFieldOpsSchema.safeParse({
      project_id: VALID_UUID,
      ticket_number: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("normalises bank_account_no by stripping non-digits", () => {
    const parsed = saveDraftFieldOpsSchema.safeParse({
      project_id: VALID_UUID,
      ticket_number: "SPK-2026-001",
      bank_account_no: "1234 5678 9012",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.bank_account_no).toBe("123456789012");
    }
  });

  it("rejects a bank_account_no shorter than 6 digits after normalisation", () => {
    const parsed = saveDraftFieldOpsSchema.safeParse({
      project_id: VALID_UUID,
      ticket_number: "SPK-2026-001",
      bank_account_no: "1-2-3",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/6-24 digits/);
    }
  });

  it("caps rab_lines at 50 rows", () => {
    const lines = Array.from({ length: 51 }, (_, i) => ({
      category: "Transportasi",
      amount: 1000 + i,
    }));
    const parsed = saveDraftFieldOpsSchema.safeParse({
      project_id: VALID_UUID,
      ticket_number: "SPK-2026-001",
      rab_lines: lines,
    });
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateDraftFieldOpsSchema — same as save but requires id.
// ---------------------------------------------------------------------------
describe("updateDraftFieldOpsSchema", () => {
  it("requires id", () => {
    const parsed = updateDraftFieldOpsSchema.safeParse({
      project_id: VALID_UUID,
      ticket_number: "SPK",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a valid update payload", () => {
    const parsed = updateDraftFieldOpsSchema.safeParse({
      id: VALID_UUID,
      project_id: VALID_UUID,
      ticket_number: "SPK-2026-001",
      unit_pengaju: "Ops-Nusa",
      area: "Jabodetabek",
    });
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// submitDraftFieldOpsSchema — minimal id-only.
// ---------------------------------------------------------------------------
describe("submitDraftFieldOpsSchema", () => {
  it("accepts a valid id", () => {
    const parsed = submitDraftFieldOpsSchema.safeParse({ id: VALID_UUID });
    expect(parsed.success).toBe(true);
  });

  it("rejects a missing id", () => {
    const parsed = submitDraftFieldOpsSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-UUID id", () => {
    const parsed = submitDraftFieldOpsSchema.safeParse({ id: "abc" });
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// submitReadyFieldOpsSchema — server-side gate.
// ---------------------------------------------------------------------------
describe("submitReadyFieldOpsSchema", () => {
  function fullValid() {
    return {
      project_id: VALID_UUID,
      ticket_number: "SPK-2026-001",
      unit_pengaju: "Ops-Nusa",
      area: "Jabodetabek",
      tujuan: "Site Warehouse Cikarang",
      transport_need: "Motor",
      bank_owner_name: "Eko Prasetyo",
      bank_name: "BCA",
      bank_account_no: "1234567890",
      rab_lines: [{ category: "Transportasi", amount: 500_000 }],
    };
  }

  it("accepts a complete submission", () => {
    const parsed = submitReadyFieldOpsSchema.safeParse(fullValid());
    expect(parsed.success).toBe(true);
  });

  it("rejects a submission with zero RAB lines (min 1)", () => {
    const parsed = submitReadyFieldOpsSchema.safeParse({
      ...fullValid(),
      rab_lines: [],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/Minimal 1 baris/);
    }
  });

  it("rejects a submission with more than 50 RAB lines", () => {
    const parsed = submitReadyFieldOpsSchema.safeParse({
      ...fullValid(),
      rab_lines: Array.from({ length: 51 }, () => ({
        category: "Konsumsi",
        amount: 1000,
      })),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/Maksimal 50/);
    }
  });

  it("rejects an empty unit_pengaju (required at submit)", () => {
    const parsed = submitReadyFieldOpsSchema.safeParse({
      ...fullValid(),
      unit_pengaju: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty area (required at submit)", () => {
    const parsed = submitReadyFieldOpsSchema.safeParse({
      ...fullValid(),
      area: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a bank_account_no that isn't 6-24 digits", () => {
    const parsed = submitReadyFieldOpsSchema.safeParse({
      ...fullValid(),
      bank_account_no: "abc",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a bank_account_no of exactly 5 digits (boundary)", () => {
    const parsed = submitReadyFieldOpsSchema.safeParse({
      ...fullValid(),
      bank_account_no: "12345",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a bank_account_no of exactly 6 digits (lower boundary)", () => {
    const parsed = submitReadyFieldOpsSchema.safeParse({
      ...fullValid(),
      bank_account_no: "123456",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a bank_account_no of exactly 24 digits (upper boundary)", () => {
    const parsed = submitReadyFieldOpsSchema.safeParse({
      ...fullValid(),
      bank_account_no: "1".repeat(24),
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a bank_account_no of 25 digits (over upper boundary)", () => {
    const parsed = submitReadyFieldOpsSchema.safeParse({
      ...fullValid(),
      bank_account_no: "1".repeat(25),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a RAB row with an empty category (individual row still validated)", () => {
    const parsed = submitReadyFieldOpsSchema.safeParse({
      ...fullValid(),
      rab_lines: [{ category: "", amount: 500_000 }],
    });
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deleteDraftFieldOpsSchema — id only.
// ---------------------------------------------------------------------------
describe("deleteDraftFieldOpsSchema", () => {
  it("accepts a valid id", () => {
    const parsed = deleteDraftFieldOpsSchema.safeParse({ id: VALID_UUID });
    expect(parsed.success).toBe(true);
  });

  it("rejects a missing id", () => {
    const parsed = deleteDraftFieldOpsSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });
});
