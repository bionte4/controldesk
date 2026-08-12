import { describe, expect, it } from "vitest";

import {
  keyClient,
  normalizeCode,
  resolveClient,
  resolveCoa,
  resolveEmployeeByEmail,
  resolveLookup,
  resolveProject,
  type ResolverMaps,
} from "./resolver";

const emptyMaps = (): ResolverMaps => ({
  lookupByDomainCode: new Map(),
  clientByKey: new Map(),
  projectByCode: new Map(),
  coaByCode: new Map(),
  budgetByProjectYear: new Map(),
  employeeByEmail: new Map(),
});

describe("resolver/normalizeCode", () => {
  it("trims and uppercases", () => {
    expect(normalizeCode("  eng ")).toBe("ENG");
  });
});

describe("resolver/keyClient", () => {
  it("trims and lowercases", () => {
    expect(keyClient("  Acme Corp ")).toBe("acme corp");
  });
});

describe("resolver/resolveLookup", () => {
  it("returns undefined for unknown domain", () => {
    const maps = emptyMaps();
    expect(resolveLookup(maps, "department", "ENG")).toBeUndefined();
  });

  it("case-insensitive lookup", () => {
    const maps = emptyMaps();
    const inner = new Map([
      ["ENG", "dept-1"],
      ["OPS", "dept-2"],
    ]);
    maps.lookupByDomainCode.set("department", inner);
    expect(resolveLookup(maps, "department", "eng")).toBe("dept-1");
    expect(resolveLookup(maps, "department", " ops ")).toBe("dept-2");
    expect(resolveLookup(maps, "department", "unknown")).toBeUndefined();
  });
});

describe("resolver/resolveClient", () => {
  it("resolves by name/contract/project_code (case-insensitive)", () => {
    const maps = emptyMaps();
    maps.clientByKey.set("acme corp", "cli-1");
    maps.clientByKey.set("ctr-2026-001", "cli-1");
    expect(resolveClient(maps, "Acme Corp")).toBe("cli-1");
    expect(resolveClient(maps, "CTR-2026-001")).toBe("cli-1");
    expect(resolveClient(maps, "unknown")).toBeUndefined();
  });
});

describe("resolver/resolveProject", () => {
  it("normalises code", () => {
    const maps = emptyMaps();
    maps.projectByCode.set("ACME-01", "proj-1");
    expect(resolveProject(maps, "acme-01")).toBe("proj-1");
    expect(resolveProject(maps, "  ACME-01 ")).toBe("proj-1");
    expect(resolveProject(maps, "nope")).toBeUndefined();
  });
});

describe("resolver/resolveCoa + resolveEmployeeByEmail", () => {
  it("resolveCoa handles case", () => {
    const maps = emptyMaps();
    maps.coaByCode.set("5100-01", "coa-1");
    expect(resolveCoa(maps, "5100-01")).toBe("coa-1");
  });

  it("resolveEmployeeByEmail is case-insensitive", () => {
    const maps = emptyMaps();
    maps.employeeByEmail.set("john.doe@example.com", "emp-1");
    expect(resolveEmployeeByEmail(maps, "John.Doe@Example.COM")).toBe("emp-1");
  });
});
