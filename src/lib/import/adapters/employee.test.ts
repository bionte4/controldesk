import { describe, expect, it } from "vitest";

import type { ResolverMaps } from "../resolver";

import { employeeAdapter } from "./employee";

function buildMaps(): ResolverMaps {
  const maps: ResolverMaps = {
    lookupByDomainCode: new Map(),
    clientByKey: new Map(),
    projectByCode: new Map(),
    coaByCode: new Map(),
    budgetByProjectYear: new Map(),
    employeeByEmail: new Map(),
  };
  const dept = new Map([
    ["ENG", "dept-eng"],
    ["OPS", "dept-ops"],
  ]);
  const pos = new Map([["DEV-01", "pos-dev-01"]]);
  maps.lookupByDomainCode.set("department", dept);
  maps.lookupByDomainCode.set("position", pos);
  return maps;
}

const TENANT = "00000000-0000-0000-0000-000000000001";

describe("employeeAdapter.validate", () => {
  it("accepts a well-formed row", async () => {
    const maps = buildMaps();
    const res = await employeeAdapter.validate({
      rows: [
        {
          firstname: "John",
          lastname: "Doe",
          email: "john.doe@example.com",
          departmentcode: "ENG",
          positioncode: "DEV-01",
          joindate: "2026-01-15",
        },
      ],
      maps,
      tenantId: TENANT,
    });
    expect(res.errors).toEqual([]);
    expect(res.valid).toHaveLength(1);
    expect(res.valid[0].commit).toMatchObject({
      full_name: "John Doe",
      email: "john.doe@example.com",
      department: "ENG",
      position_title: "DEV-01",
      employment_type: "PERMANENT",
      availability: "AVAILABLE",
      contract_end_date: null,
    });
  });

  it("rejects unknown department code", async () => {
    const maps = buildMaps();
    const res = await employeeAdapter.validate({
      rows: [
        {
          firstname: "Jane",
          lastname: "Roe",
          email: "jane@example.com",
          departmentcode: "UNKNOWN",
          positioncode: "DEV-01",
          joindate: "2026-01-15",
        },
      ],
      maps,
      tenantId: TENANT,
    });
    expect(res.valid).toHaveLength(0);
    expect(res.errors[0]).toMatchObject({
      row_number: 1,
      field: "departmentcode",
    });
  });

  it("rejects duplicate emails in the same file", async () => {
    const maps = buildMaps();
    const res = await employeeAdapter.validate({
      rows: [
        {
          firstname: "A",
          lastname: "One",
          email: "dupe@example.com",
          departmentcode: "ENG",
          positioncode: "DEV-01",
          joindate: "2026-01-15",
        },
        {
          firstname: "B",
          lastname: "Two",
          email: "DUPE@example.com",
          departmentcode: "ENG",
          positioncode: "DEV-01",
          joindate: "2026-01-15",
        },
      ],
      maps,
      tenantId: TENANT,
    });
    expect(res.valid).toHaveLength(1);
    expect(res.errors[0].field).toBe("email");
  });

  it("requires end_date when employment_type ≠ PERMANENT", async () => {
    const maps = buildMaps();
    const res = await employeeAdapter.validate({
      rows: [
        {
          firstname: "A",
          lastname: "One",
          email: "a@example.com",
          departmentcode: "ENG",
          positioncode: "DEV-01",
          joindate: "2026-01-15",
          employmentstatus: "CONTRACT",
        },
      ],
      maps,
      tenantId: TENANT,
    });
    expect(res.valid).toHaveLength(0);
    expect(res.errors[0].field).toBe("enddate");
  });

  it("rejects non-ISO date", async () => {
    const maps = buildMaps();
    const res = await employeeAdapter.validate({
      rows: [
        {
          firstname: "A",
          lastname: "One",
          email: "a@example.com",
          departmentcode: "ENG",
          positioncode: "DEV-01",
          joindate: "15/01/2026",
        },
      ],
      maps,
      tenantId: TENANT,
    });
    expect(res.valid).toHaveLength(0);
    expect(res.errors[0].field).toBe("joindate");
  });
});
