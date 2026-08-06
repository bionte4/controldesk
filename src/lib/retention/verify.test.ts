import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

import { checksumOf, compareChecksum } from "./verify";

describe("checksumOf", () => {
  it("recomputes SHA-256 over gunzipped NDJSON matching the serializer", () => {
    const ndjson = '{"a":1}\n{"b":2}';
    const expected = createHash("sha256").update(ndjson, "utf8").digest("hex");
    const bytes = new Uint8Array(gzipSync(Buffer.from(ndjson, "utf8")));

    const res = checksumOf(bytes);
    expect(res.checksum).toBe(expected);
    expect(res.ndjson_length).toBe(Buffer.byteLength(ndjson, "utf8"));
    expect(res.bytes_read).toBe(bytes.byteLength);
  });

  it("accepts a Buffer as well as a Uint8Array", () => {
    const ndjson = "hello world";
    const bytes = gzipSync(Buffer.from(ndjson, "utf8"));
    const res = checksumOf(bytes);
    expect(res.checksum).toBe(
      createHash("sha256").update(ndjson, "utf8").digest("hex"),
    );
  });

  it("throws on non-gzip payloads (registered blob is corrupted)", () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(() => checksumOf(garbage)).toThrow();
  });
});

describe("compareChecksum", () => {
  const CHECKSUM_A =
    "cf80cd8aed482d5d1527d7dc72fceff84e6326592848447d2dc0b0e87dfc9a90";
  const CHECKSUM_B =
    "1234567890123456789012345678901234567890123456789012345678901234";

  it("matches identical checksums, case-insensitive", () => {
    expect(
      compareChecksum({ checksum_sha256: CHECKSUM_A }, CHECKSUM_A).match,
    ).toBe(true);
    expect(
      compareChecksum(
        { checksum_sha256: CHECKSUM_A.toUpperCase() },
        CHECKSUM_A,
      ).match,
    ).toBe(true);
  });

  it("rejects mismatched checksums", () => {
    expect(
      compareChecksum({ checksum_sha256: CHECKSUM_A }, CHECKSUM_B).match,
    ).toBe(false);
  });

  it("rejects empty stored checksum even if recomputed matches empty string", () => {
    // An empty registry checksum (from a FAILED batch) must never
    // accidentally verify.
    expect(compareChecksum({ checksum_sha256: "" }, "").match).toBe(false);
  });
});
