/**
 * Shared skeleton for ControlDesk transactional emails (rules §20).
 *
 * Every email we send (signup, digest, reminders, approvals, ...) uses the
 * same wrapper so the visual identity + accessibility floor is enforced in
 * one place. Callers hand over structured `sections` and a `greeting`; this
 * module returns both a `text/plain` and a `text/html` body ready for
 * Nodemailer.
 *
 * Contract:
 *   - Pure. No I/O, no locale side effects, no imports from `next/*`.
 *   - Renderer runs on the server (crons + server actions). Never called
 *     from a client component.
 *   - HTML is inline-styled only (email clients strip <style> and drop
 *     external stylesheets). Colors mirror the app design tokens.
 *   - Text body is the source of truth — every field that appears in HTML
 *     also appears in text so it works in HTML-off clients.
 *   - All user-provided strings go through `escapeHtml()` before hitting
 *     the DOM. Callers that pass already-safe primitives (numbers,
 *     enum values) can rely on the wrapper without pre-escaping.
 *
 * Why not React Email / MJML: adds ~500 KB of deps for a codebase that
 * ships four static templates. If the design system grows non-trivially,
 * revisit.
 */

/** Section rendered inside the email body. */
export type EmailSection =
  | {
      /** Heading rendered as <h2> and text-body `## Heading`. */
      heading: string;
      /**
       * Body text below the heading. Line breaks preserved in HTML via
       * `<br/>` mapping. Falsy → skipped.
       */
      body?: string;
      /** Bullet list rendered as <ul> and `  • item` in text. */
      items?: readonly string[];
    }
  | {
      /** Bare paragraph without a heading. */
      body: string;
    }
  | {
      /** Preformatted block (login credentials, action URLs, ...). */
      preformatted: string;
    };

/** Optional CTA button rendered below the last section. */
export type EmailCta = {
  label: string;
  url: string;
};

export type EmailBundleInput = {
  /**
   * Tenant name shown as an eyebrow above the subject. Falsy → hidden
   * (useful for signup emails before the tenant exists).
   */
  tenantName?: string;
  /** H1 rendered inside the card + subject line source. */
  title: string;
  /**
   * Optional preheader shown in email client previews. Not rendered in
   * text version. Keep ≤ 90 characters.
   */
  preheader?: string;
  /** First-line salutation, e.g. "Halo Andi,". */
  greeting: string;
  /** Ordered content sections. */
  sections: readonly EmailSection[];
  /** Optional call-to-action button. */
  cta?: EmailCta;
  /**
   * Footer paragraph shown at the bottom. Defaults to the generic
   * "email otomatis" note.
   */
  footerNote?: string;
};

export type EmailBody = {
  text: string;
  html: string;
};

const DEFAULT_FOOTER =
  "Email ini otomatis dikirim ControlDesk. Balasan email tidak dipantau — silakan gunakan tautan di dalam email untuk merespons.";

/**
 * Render both bodies. Callers wrap this in a per-template renderer that
 * also returns the subject, e.g.:
 *   const { text, html } = renderEmailBody({ ... });
 *   return { subject, text, html };
 */
export function renderEmailBody(input: EmailBundleInput): EmailBody {
  return {
    text: renderText(input),
    html: renderHtml(input),
  };
}

// ---------------------------------------------------------------------------
// Text renderer
// ---------------------------------------------------------------------------
function renderText(input: EmailBundleInput): string {
  const lines: string[] = [];
  if (input.tenantName) {
    lines.push(`[${input.tenantName}]`, "");
  }
  lines.push(input.title, "".padEnd(input.title.length, "="), "");
  lines.push(input.greeting, "");

  for (const section of input.sections) {
    if ("preformatted" in section) {
      lines.push(section.preformatted, "");
      continue;
    }
    if ("heading" in section) {
      lines.push(`## ${section.heading}`);
      if (section.body) {
        lines.push(section.body);
      }
      if (section.items && section.items.length > 0) {
        for (const item of section.items) {
          lines.push(`  • ${item}`);
        }
      }
      lines.push("");
      continue;
    }
    lines.push(section.body, "");
  }

  if (input.cta) {
    lines.push(`${input.cta.label}: ${input.cta.url}`, "");
  }

  lines.push(input.footerNote ?? DEFAULT_FOOTER);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// HTML renderer
// ---------------------------------------------------------------------------
const TOKENS = {
  bgOuter: "#f1f5f9",
  bgCard: "#ffffff",
  borderCard: "#e2e8f0",
  fgPrimary: "#0f172a",
  fgSecondary: "#334155",
  fgMuted: "#64748b",
  accent: "#4f46e5",
  accentContrast: "#ffffff",
  eyebrow: "#6366f1",
  fontStack:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', ui-sans-serif, sans-serif",
} as const;

function renderHtml(input: EmailBundleInput): string {
  const eyebrow = input.tenantName
    ? `<p style="margin:0 0 4px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${TOKENS.eyebrow};font-weight:600">${escapeHtml(
        input.tenantName,
      )}</p>`
    : "";
  const preheader = input.preheader
    ? `<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">${escapeHtml(
        input.preheader,
      )}</div>`
    : "";
  const cta = input.cta ? renderCta(input.cta) : "";
  const sections = input.sections.map(renderSection).join("");

  return `<!doctype html>
<html lang="id"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<title>${escapeHtml(input.title)}</title>
</head><body style="margin:0;padding:0;background:${TOKENS.bgOuter};font-family:${TOKENS.fontStack};color:${TOKENS.fgPrimary}">
${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${TOKENS.bgOuter}">
  <tr><td align="center" style="padding:24px 16px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:${TOKENS.bgCard};border:1px solid ${TOKENS.borderCard};border-radius:16px;overflow:hidden">
      <tr><td style="padding:32px 32px 8px 32px">
        ${eyebrow}
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${TOKENS.fgPrimary};font-weight:700">${escapeHtml(
          input.title,
        )}</h1>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${TOKENS.fgPrimary}">${escapeHtml(
          input.greeting,
        )}</p>
      </td></tr>
      <tr><td style="padding:0 32px 8px 32px">${sections}${cta}</td></tr>
      <tr><td style="padding:16px 32px 28px 32px;border-top:1px solid ${TOKENS.borderCard}">
        <p style="margin:16px 0 0;font-size:11px;line-height:1.6;color:${TOKENS.fgMuted}">${escapeHtml(
          input.footerNote ?? DEFAULT_FOOTER,
        )}</p>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:11px;color:${TOKENS.fgMuted}">ControlDesk · <a href="https://controldesk.app" style="color:${TOKENS.fgMuted};text-decoration:underline">controldesk.app</a></p>
  </td></tr>
</table>
</body></html>`;
}

function renderSection(section: EmailSection): string {
  if ("preformatted" in section) {
    return `<pre style="margin:0 0 16px;padding:12px 16px;background:${TOKENS.bgOuter};border:1px solid ${TOKENS.borderCard};border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.6;color:${TOKENS.fgPrimary};white-space:pre-wrap;word-break:break-word">${escapeHtml(
      section.preformatted,
    )}</pre>`;
  }
  if ("heading" in section) {
    const body = section.body
      ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:${TOKENS.fgPrimary}">${escapeHtmlPreserveBreaks(
          section.body,
        )}</p>`
      : "";
    const items =
      section.items && section.items.length > 0
        ? `<ul style="margin:0 0 12px;padding-left:20px;color:${TOKENS.fgPrimary};font-size:14px;line-height:1.7">${section.items
            .map(
              (item) =>
                `<li style="margin:0 0 4px">${escapeHtml(item)}</li>`,
            )
            .join("")}</ul>`
        : "";
    return `
      <h2 style="margin:16px 0 8px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:${TOKENS.fgSecondary}">${escapeHtml(
        section.heading,
      )}</h2>
      ${body}
      ${items}
    `;
  }
  return `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${TOKENS.fgPrimary}">${escapeHtmlPreserveBreaks(
    section.body,
  )}</p>`;
}

function renderCta(cta: EmailCta): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 20px">
      <tr><td style="background:${TOKENS.accent};border-radius:10px">
        <a href="${escapeHtmlAttr(cta.url)}" style="display:inline-block;padding:12px 22px;color:${TOKENS.accentContrast};font-size:14px;font-weight:600;text-decoration:none;font-family:${TOKENS.fontStack}">${escapeHtml(
          cta.label,
        )}</a>
      </td></tr>
    </table>
    <p style="margin:0 0 8px;font-size:12px;color:${TOKENS.fgMuted};line-height:1.6">Kalau tombol tidak bisa diklik, salin tautan ini ke browser:<br/><span style="word-break:break-all;color:${TOKENS.fgSecondary}">${escapeHtml(
      cta.url,
    )}</span></p>
  `;
}

// ---------------------------------------------------------------------------
// Escaping helpers
// ---------------------------------------------------------------------------

/** Standard HTML text-node escape. Exported for callers assembling ad-hoc snippets. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape for use in `href="..."` / attribute contexts. Alias of escapeHtml — the double-quote replacement is sufficient. */
export function escapeHtmlAttr(input: string): string {
  return escapeHtml(input);
}

/** Same as escapeHtml but converts `\n` to `<br/>` so multi-line bodies keep line breaks. */
function escapeHtmlPreserveBreaks(input: string): string {
  return escapeHtml(input).replace(/\n/g, "<br/>");
}
