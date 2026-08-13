import type { ReactNode } from "react";

/**
 * `/help` is available to every authenticated user regardless of role
 * — help content is universal. We do NOT wrap in a role gate here;
 * the parent `(app)/layout.tsx` already requires an authenticated
 * session and enforces tenant isolation. Content itself is static
 * (from `docs/`) so there's no data leak surface.
 *
 * Kept as a passthrough layout so future work (e.g. embedding an "Ask
 * ControlDesk" chatbot side rail at Fase 2) has a stable insertion point.
 */
export default function HelpLayout({ children }: { children: ReactNode }) {
  return children;
}
