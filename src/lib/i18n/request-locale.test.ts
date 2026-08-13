import { describe, expect, it } from "vitest";

import {
  parseAcceptLanguage,
  resolveRequestLocale,
} from "./request-locale";

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

function makeCookies(value: string | undefined): CookieReader {
  return {
    get: (name: string) =>
      name === "NEXT_LOCALE" && value ? { value } : undefined,
  };
}

describe("resolveRequestLocale", () => {
  it("prefers the NEXT_LOCALE cookie over the Accept-Language header", () => {
    const locale = resolveRequestLocale({
      cookies: makeCookies("en"),
      acceptLanguage: "id-ID,id;q=0.9",
    });
    expect(locale).toBe("en");
  });

  it("respects a `id` cookie even when the browser prefers English", () => {
    const locale = resolveRequestLocale({
      cookies: makeCookies("id"),
      acceptLanguage: "en-US,en;q=0.9",
    });
    expect(locale).toBe("id");
  });

  it("falls back to Accept-Language when no cookie is set", () => {
    expect(
      resolveRequestLocale({
        cookies: makeCookies(undefined),
        acceptLanguage: "en-US,en;q=0.9",
      }),
    ).toBe("en");
  });

  it("ignores an invalid cookie value and falls back to the header", () => {
    expect(
      resolveRequestLocale({
        cookies: makeCookies("fr"),
        acceptLanguage: "en-US,en;q=0.9",
      }),
    ).toBe("en");
  });

  it("returns the default locale when neither cookie nor header exist", () => {
    expect(
      resolveRequestLocale({
        cookies: null,
        acceptLanguage: null,
      }),
    ).toBe("id");
  });

  it("tolerates a missing cookie reader (SSG / static paths)", () => {
    expect(
      resolveRequestLocale({
        cookies: null,
        acceptLanguage: "en",
      }),
    ).toBe("en");
  });
});

describe("parseAcceptLanguage", () => {
  it("returns id for an empty header", () => {
    expect(parseAcceptLanguage(null)).toBe("id");
    expect(parseAcceptLanguage("")).toBe("id");
  });

  it("returns en when the first tag starts with en", () => {
    expect(parseAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(parseAcceptLanguage("EN")).toBe("en");
  });

  it("returns id when the first tag starts with id", () => {
    expect(parseAcceptLanguage("id-ID,id;q=0.9")).toBe("id");
  });

  it("defaults to id for unrecognized locales", () => {
    expect(parseAcceptLanguage("fr-FR,fr;q=0.9")).toBe("id");
  });
});
