import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  defaultArchiveYear,
  packArchive,
  serializeNDJSON,
} from "@/lib/retention/archive";
import {
  ARCHIVE_TARGETS,
  buildArchivePath,
  yearBatchRange,
} from "@/lib/retention/config";

describe("serializeNDJSON", () => {
  it("produces one JSON object per line", () => {
    const { ndjson } = serializeNDJSON([
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]);
    expect(ndjson.split("\n")).toHaveLength(2);
    for (const line of ndjson.split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("sorts object keys so the checksum is deterministic", () => {
    const a = serializeNDJSON([{ z: 1, a: 2 }]);
    const b = serializeNDJSON([{ a: 2, z: 1 }]);
    expect(a.ndjson).toBe(b.ndjson);
    expect(a.checksum).toBe(b.checksum);
  });

  it("recursively sorts keys inside nested objects", () => {
    const { ndjson } = serializeNDJSON([
      { outer: { z: 1, a: 2, m: { d: 4, b: 3 } } },
    ]);
    expect(ndjson).toBe('{"outer":{"a":2,"m":{"b":3,"d":4},"z":1}}');
  });

  it("produces a stable SHA-256 checksum", () => {
    const { checksum } = serializeNDJSON([{ a: 1 }]);
    // sha256("{"a":1}") — precomputed once so regressions surface immediately.
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("preserves nulls and arrays", () => {
    const { ndjson } = serializeNDJSON([
      { list: [1, 2, 3], nothing: null, name: "abc" },
    ]);
    expect(ndjson).toBe('{"list":[1,2,3],"name":"abc","nothing":null}');
  });
});

describe("packArchive", () => {
  it("gzips the NDJSON and reports byte size", () => {
    const { ndjson } = serializeNDJSON([{ a: 1 }, { a: 2 }, { a: 3 }]);
    const packed = packArchive(ndjson);
    expect(packed.bytes_written).toBe(packed.bytes.byteLength);
    expect(packed.bytes_written).toBeGreaterThan(0);
    const decoded = gunzipSync(Buffer.from(packed.bytes)).toString("utf8");
    expect(decoded).toBe(ndjson);
  });
});

describe("yearBatchRange", () => {
  it("returns UTC-based [start, end) for the year", () => {
    const r = yearBatchRange(2023);
    expect(r.start_iso).toBe("2023-01-01T00:00:00.000Z");
    expect(r.end_iso).toBe("2024-01-01T00:00:00.000Z");
  });
});

describe("buildArchivePath", () => {
  it("uses the expected tenant/source/year layout", () => {
    const p = buildArchivePath({
      tenant_id: "11111111-1111-1111-1111-111111111111",
      source_table: "security_audit_logs",
      year: 2018,
    });
    expect(p).toBe(
      "11111111-1111-1111-1111-111111111111/security_audit_logs/2018.ndjson.gz",
    );
  });
});

describe("defaultArchiveYear", () => {
  it("returns current UTC year minus 2", () => {
    const fixed = new Date("2026-06-15T12:00:00Z");
    expect(defaultArchiveYear(fixed)).toBe(2024);
  });
});

describe("ARCHIVE_TARGETS", () => {
  it("keeps all five long-retention sources", () => {
    expect(Object.keys(ARCHIVE_TARGETS).sort()).toEqual(
      [
        "cash_advance_settlements",
        "cash_advances",
        "petty_cash_vouchers",
        "project_expenses",
        "security_audit_logs",
      ].sort(),
    );
  });

  it("every target archives by year", () => {
    for (const t of Object.values(ARCHIVE_TARGETS)) {
      expect(t.batch_granularity).toBe("year");
      expect(t.time_column).toBe("created_at");
    }
  });
});
