import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  renderEmailBody,
  type EmailBundleInput,
} from "./skeleton";

const baseInput: EmailBundleInput = {
  tenantName: "PT Acme Nusantara",
  title: "Workspace Anda siap",
  greeting: "Halo Andi,",
  sections: [
    {
      heading: "Rincian akun",
      preformatted:
        "URL:      https://acme.controldesk.app/login\nEmail:    andi@acme.co.id",
    },
    {
      body: "Uji coba 14 hari aktif otomatis.",
    },
  ],
  cta: { label: "Buka workspace", url: "https://acme.controldesk.app/login" },
};

describe("renderEmailBody", () => {
  it("returns both text and html for the same bundle", () => {
    const body = renderEmailBody(baseInput);
    expect(body.text).toContain("Halo Andi,");
    expect(body.text).toContain("URL:      https://acme.controldesk.app/login");
    expect(body.text).toContain(
      "Buka workspace: https://acme.controldesk.app/login",
    );
    expect(body.html).toContain("<h1");
    expect(body.html).toContain("Workspace Anda siap");
    expect(body.html).toContain("PT Acme Nusantara");
    expect(body.html).toContain(
      'href="https://acme.controldesk.app/login"',
    );
  });

  it("escapes HTML in user-provided strings so raw <script> cannot break out", () => {
    const body = renderEmailBody({
      ...baseInput,
      tenantName: "<script>alert(1)</script>",
      greeting: "Halo \"Andi\" <b>bold</b>,",
      sections: [{ body: "line-one\nline-two & more" }],
    });
    expect(body.html).not.toContain("<script>alert(1)</script>");
    expect(body.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body.html).toContain("&quot;Andi&quot;");
    expect(body.html).toContain("&amp;");
    expect(body.html).toContain("line-one<br/>line-two");
  });

  it("hides the eyebrow when tenantName is omitted (pre-provisioning emails)", () => {
    const body = renderEmailBody({
      title: "Verifikasi pendaftaran",
      greeting: "Halo,",
      sections: [{ body: "klik tautan verifikasi." }],
    });
    expect(body.html).not.toContain("<p style=\"margin:0 0 4px;font-size:12px");
  });

  it("preserves items in text bullet list and html <ul>", () => {
    const body = renderEmailBody({
      title: "Ringkasan harian",
      greeting: "Halo Tim,",
      sections: [
        {
          heading: "Approval menunggu",
          items: ["EXP-001 · Andi", "CA-002 · Budi"],
        },
      ],
    });
    expect(body.text).toContain("  • EXP-001 · Andi");
    expect(body.text).toContain("  • CA-002 · Budi");
    expect(body.html).toContain("<ul");
    expect(body.html).toContain("<li");
    expect(body.html).toContain("EXP-001 · Andi");
  });
});

describe("escapeHtml", () => {
  it("escapes the OWASP 5-char set", () => {
    expect(escapeHtml("<a href=\"x&y\">'z'</a>")).toBe(
      "&lt;a href=&quot;x&amp;y&quot;&gt;&#39;z&#39;&lt;/a&gt;",
    );
  });
});
