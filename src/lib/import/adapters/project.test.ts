import { describe, expect, it } from "vitest";

import type { ResolverMaps } from "../resolver";

import { projectAdapter } from "./project";

function mapsWithClient(): ResolverMaps {
  const maps: ResolverMaps = {
    lookupByDomainCode: new Map(),
    clientByKey: new Map([["acme corp", "cli-1"]]),
    projectByCode: new Map(),
    coaByCode: new Map(),
    budgetByProjectYear: new Map(),
    employeeByEmail: new Map(),
  };
  return maps;
}

const TENANT = "00000000-0000-0000-0000-000000000001";

describe("projectAdapter.validate", () => {
  it("accepts a well-formed row and resolves client", async () => {
    const maps = mapsWithClient();
    const res = await projectAdapter.validate({
      rows: [
        {
          code: "ACME-01",
          name: "Acme onboarding",
          clientname: "Acme Corp",
        },
      ],
      maps,
      tenantId: TENANT,
    });
    expect(res.errors).toEqual([]);
    expect(res.valid[0].commit.client_id).toBe("cli-1");
    expect(res.valid[0].commit.code).toBe("ACME-01");
    expect(res.valid[0].commit.status).toBe("PLANNING");
  });

  it("rejects unknown client", async () => {
    const res = await projectAdapter.validate({
      rows: [
        {
          code: "ACME-01",
          name: "Foo",
          clientname: "Unknown Ltd",
        },
      ],
      maps: mapsWithClient(),
      tenantId: TENANT,
    });
    expect(res.valid).toHaveLength(0);
    expect(res.errors[0].field).toBe("clientname");
  });

  it("rejects when end_date is before start_date", async () => {
    const res = await projectAdapter.validate({
      rows: [
        {
          code: "ACME-01",
          name: "Foo",
          clientname: "Acme Corp",
          startdate: "2026-05-01",
          enddate: "2026-01-01",
        },
      ],
      maps: mapsWithClient(),
      tenantId: TENANT,
    });
    expect(res.valid).toHaveLength(0);
    expect(res.errors[0].field).toBe("enddate");
  });

  it("rejects invalid contract_value formatting", async () => {
    const res = await projectAdapter.validate({
      rows: [
        {
          code: "ACME-01",
          name: "Foo",
          clientname: "Acme Corp",
          contractvalue: "12,500,000",
        },
      ],
      maps: mapsWithClient(),
      tenantId: TENANT,
    });
    expect(res.valid).toHaveLength(0);
    expect(res.errors[0].field).toBe("contractvalue");
  });
});
