import { describe, expect, it } from "vitest";

import { deriveTitle } from "./title";

describe("deriveTitle", () => {
  it("returns null for empty / null / undefined input", () => {
    expect(deriveTitle(null)).toBeNull();
    expect(deriveTitle(undefined)).toBeNull();
    expect(deriveTitle("")).toBeNull();
    expect(deriveTitle("   \n\t  ")).toBeNull();
  });

  it("collapses whitespace and trims trailing punctuation", () => {
    expect(deriveTitle("How do I submit an expense?")).toBe(
      "How do I submit an expense",
    );
    expect(deriveTitle("Berapa\n  jam saya    minggu ini?")).toBe(
      "Berapa jam saya minggu ini",
    );
  });

  it("keeps short titles verbatim (minus trailing punctuation)", () => {
    expect(deriveTitle("Hai")).toBe("Hai");
    expect(deriveTitle("Refund policy!")).toBe("Refund policy");
  });

  it("truncates long titles on the last word boundary and appends ellipsis", () => {
    const long =
      "Bisakah saya melihat semua pengeluaran yang menunggu persetujuan saya minggu ini?";
    const title = deriveTitle(long);
    expect(title).not.toBeNull();
    expect(title!.length).toBeLessThanOrEqual(61); // 60 + ellipsis char
    expect(title!.endsWith("…")).toBe(true);
    // Should not slice mid-word.
    expect(title!.replace("…", "")).toBe(
      title!.replace("…", "").split(" ").join(" "),
    );
  });

  it("hard-truncates when the first token exceeds the cap", () => {
    const oneToken = "A".repeat(80);
    const title = deriveTitle(oneToken);
    expect(title).not.toBeNull();
    expect(title!.length).toBeLessThanOrEqual(61);
    expect(title!.endsWith("…")).toBe(true);
  });

  it("handles unicode punctuation and non-ascii scripts", () => {
    expect(deriveTitle("Apa saja fitur baru?")).toBe("Apa saja fitur baru");
    expect(deriveTitle("会議の予定を教えてください。")).toBe(
      "会議の予定を教えてください",
    );
  });
});
