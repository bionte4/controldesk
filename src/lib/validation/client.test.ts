import { describe, expect, it } from "vitest";

import {
  CLIENT_STATUSES,
  CONTRACT_STATUSES,
  clientStatusSchema,
  contractStatusSchema,
  createClientSchema,
  createContractSchema,
  updateClientSchema,
} from "@/lib/validation/client";

const VALID_UUID = "00000000-0000-4000-8000-000000000001";

describe("client schema", () => {
  it("accepts a minimal valid payload with defaults", () => {
    const parsed = createClientSchema.parse({ name: "Acme BPO" });
    expect(parsed.name).toBe("Acme BPO");
    expect(parsed.status).toBe("PROSPECT");
  });

  it("trims whitespace from name", () => {
    const parsed = createClientSchema.parse({ name: "   Acme   " });
    expect(parsed.name).toBe("Acme");
  });

  it("rejects blank / too-short names", () => {
    expect(() => createClientSchema.parse({ name: "" })).toThrow();
    expect(() => createClientSchema.parse({ name: "A" })).toThrow();
  });

  it("collapses empty optional strings to undefined", () => {
    const parsed = createClientSchema.parse({
      name: "Acme",
      industry: "",
      contact_phone: "  ",
    });
    expect(parsed.industry).toBeUndefined();
    expect(parsed.contact_phone).toBeUndefined();
  });

  it("rejects invalid contact_email", () => {
    expect(() =>
      createClientSchema.parse({ name: "Acme", contact_email: "not-an-email" }),
    ).toThrow();
  });

  it("accepts an empty contact_email as undefined", () => {
    const parsed = createClientSchema.parse({
      name: "Acme",
      contact_email: "",
    });
    expect(parsed.contact_email).toBeUndefined();
  });

  it("clientStatusSchema enumerates all statuses", () => {
    for (const status of CLIENT_STATUSES) {
      expect(clientStatusSchema.parse(status)).toBe(status);
    }
    expect(() => clientStatusSchema.parse("EXPLODED")).toThrow();
  });

  it("updateClientSchema requires id", () => {
    expect(() => updateClientSchema.parse({ name: "Acme" })).toThrow();
    const parsed = updateClientSchema.parse({
      id: VALID_UUID,
      name: "Acme 2",
    });
    expect(parsed.id).toBe(VALID_UUID);
  });
});

describe("contract schema", () => {
  it("contractStatusSchema enumerates all statuses", () => {
    for (const status of CONTRACT_STATUSES) {
      expect(contractStatusSchema.parse(status)).toBe(status);
    }
  });

  it("accepts a valid contract", () => {
    const parsed = createContractSchema.parse({
      client_id: VALID_UUID,
      contract_number: "MSA-2026-001",
      mrr_amount_idr: 15_000_000,
      start_date: "2026-01-01",
    });
    expect(parsed.mrr_amount_idr).toBe(15_000_000);
    expect(parsed.status).toBe("DRAFT");
  });

  it("rejects negative MRR", () => {
    expect(() =>
      createContractSchema.parse({
        client_id: VALID_UUID,
        contract_number: "MSA-2026-002",
        mrr_amount_idr: -1,
        start_date: "2026-01-01",
      }),
    ).toThrow();
  });

  it("rejects non-integer MRR", () => {
    expect(() =>
      createContractSchema.parse({
        client_id: VALID_UUID,
        contract_number: "MSA-2026-003",
        mrr_amount_idr: 1_000.5,
        start_date: "2026-01-01",
      }),
    ).toThrow();
  });

  it("rejects an end_date earlier than the start_date", () => {
    expect(() =>
      createContractSchema.parse({
        client_id: VALID_UUID,
        contract_number: "MSA-2026-004",
        mrr_amount_idr: 1_000_000,
        start_date: "2026-06-01",
        end_date: "2026-01-01",
      }),
    ).toThrow(/End date/i);
  });

  it("rejects malformed date strings", () => {
    expect(() =>
      createContractSchema.parse({
        client_id: VALID_UUID,
        contract_number: "MSA-2026-005",
        mrr_amount_idr: 1_000_000,
        start_date: "06/01/2026",
      }),
    ).toThrow();
  });
});
