import { describe, expect, it } from "vitest";

import type { ResolverMaps } from "../resolver";

import { budgetLineAdapter } from "./budget-line";

function maps(): ResolverMaps {
  return {
    lookupByDomainCode: new Map(),
    clientByKey: new Map(),
    projectByCode: new Map([["ACME-01", "proj-1"]]),
    coaByCode: new Map([
      ["5100-01", "coa-1"],
      ["5200-01", "coa-2"],
    ]),
    budgetByProjectYear: new Map(),
    employeeByEmail: new Map(),
  };
}

const TENANT = "00000000-0000-0000-0000-000000000001";

describe("budgetLineAdapter.validate", () => {
  it("accepts a well-formed line", async () => {
    const res = await budgetLineAdapter.validate({
      rows: [
        {
          projectcode: "ACME-01",
          fiscalyear: "2026",
          coacode: "5100-01",
          category: "Salary",
          plannedamount: "50000000",
        },
      ],
      maps: maps(),
      tenantId: TENANT,
    });
    expect(res.errors).toEqual([]);
    expect(res.valid[0].commit).toMatchObject({
      project_id: "proj-1",
      coa_id: "coa-1",
      fiscal_year: 2026,
      planned_amount: 50000000,
    });
  });

  it("rejects unknown project code", async () => {
    const res = await budgetLineAdapter.validate({
      rows: [
        {
          projectcode: "GHOST",
          fiscalyear: "2026",
          coacode: "5100-01",
          category: "Salary",
          plannedamount: "50000000",
        },
      ],
      maps: maps(),
      tenantId: TENANT,
    });
    expect(res.valid).toHaveLength(0);
    expect(res.errors[0].field).toBe("projectcode");
  });

  it("rejects unknown COA code", async () => {
    const res = await budgetLineAdapter.validate({
      rows: [
        {
          projectcode: "ACME-01",
          fiscalyear: "2026",
          coacode: "9999-99",
          category: "Salary",
          plannedamount: "50000000",
        },
      ],
      maps: maps(),
      tenantId: TENANT,
    });
    expect(res.valid).toHaveLength(0);
    expect(res.errors[0].field).toBe("coacode");
  });

  it("rejects duplicate (project, year, coa)", async () => {
    const res = await budgetLineAdapter.validate({
      rows: [
        {
          projectcode: "ACME-01",
          fiscalyear: "2026",
          coacode: "5100-01",
          category: "A",
          plannedamount: "10000000",
        },
        {
          projectcode: "ACME-01",
          fiscalyear: "2026",
          coacode: "5100-01",
          category: "B",
          plannedamount: "20000000",
        },
      ],
      maps: maps(),
      tenantId: TENANT,
    });
    expect(res.valid).toHaveLength(1);
    expect(res.errors[0].field).toBe("coacode");
  });

  it("rejects non-numeric planned_amount", async () => {
    const res = await budgetLineAdapter.validate({
      rows: [
        {
          projectcode: "ACME-01",
          fiscalyear: "2026",
          coacode: "5100-01",
          category: "Salary",
          plannedamount: "Rp 50.000.000",
        },
      ],
      maps: maps(),
      tenantId: TENANT,
    });
    expect(res.valid).toHaveLength(0);
    expect(res.errors[0].field).toBe("plannedamount");
  });
});
