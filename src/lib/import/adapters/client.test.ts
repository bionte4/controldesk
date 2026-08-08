import { describe, expect, it } from "vitest";

import type { ResolverMaps } from "../resolver";

import { clientAdapter } from "./client";

const EMPTY_MAPS: ResolverMaps = {
  lookupByDomainCode: new Map(),
  clientByKey: new Map(),
  projectByCode: new Map(),
  coaByCode: new Map(),
  budgetByProjectYear: new Map(),
  employeeByEmail: new Map(),
};

const TENANT = "00000000-0000-0000-0000-000000000001";

describe("clientAdapter.validate", () => {
  it("accepts a well-formed row and defaults status = PROSPECT", async () => {
    const res = await clientAdapter.validate({
      rows: [{ name: "Acme Corp" }],
      maps: EMPTY_MAPS,
      tenantId: TENANT,
    });
    expect(res.errors).toEqual([]);
    expect(res.valid[0].commit.status).toBe("PROSPECT");
  });

  it("rejects invalid email", async () => {
    const res = await clientAdapter.validate({
      rows: [{ name: "Acme Corp", contactemail: "not-an-email" }],
      maps: EMPTY_MAPS,
      tenantId: TENANT,
    });
    expect(res.valid).toHaveLength(0);
    expect(res.errors[0].field).toBe("contactemail");
  });

  it("rejects duplicate client name in file", async () => {
    const res = await clientAdapter.validate({
      rows: [{ name: "Acme Corp" }, { name: "ACME CORP" }],
      maps: EMPTY_MAPS,
      tenantId: TENANT,
    });
    expect(res.valid).toHaveLength(1);
    expect(res.errors[0].field).toBe("name");
  });

  it("normalises unknown status to error", async () => {
    const res = await clientAdapter.validate({
      rows: [{ name: "Acme Corp", status: "MYSTERY" }],
      maps: EMPTY_MAPS,
      tenantId: TENANT,
    });
    expect(res.valid).toHaveLength(0);
    expect(res.errors[0].field).toBe("status");
  });
});
