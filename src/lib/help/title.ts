/**
 * Derive a short, human-friendly title from the first user turn of a
 * chatbot conversation. Called exactly once per conversation — when
 * the parent row is being inserted — and never mutated after that
 * (subsequent turns keep the original title so the sidebar stays
 * stable across the thread's lifetime).
 *
 * Design rules:
 *
 *   • Cap length at ~60 characters. Longer titles wrap ugly in the
 *     sidebar and add noise to `security_audit_logs` diffs.
 *   • Collapse whitespace so multi-line questions don't yield a title
 *     with hard newlines in the middle.
 *   • Strip trailing punctuation because "How do I submit an expense?"
 *     looks the same as "How do I submit an expense" once truncated,
 *     but the punctuation-less form is easier to scan.
 *   • Fallback for empty / whitespace-only input: return `null` so the
 *     UI can render its locale-aware "New conversation" placeholder
 *     instead of an ambiguous blank.
 *
 * The output is stored in `tenant_chat_conversations.title`. The
 * conversation is owned by (tenant_id, user_id) — RLS refuses reads
 * for anyone else — so even a title containing PII stays private to
 * the author.
 */

const MAX_TITLE_LENGTH = 60;

export function deriveTitle(userMessage: string | null | undefined): string | null {
  if (!userMessage) return null;

  const collapsed = userMessage.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;

  if (collapsed.length <= MAX_TITLE_LENGTH) {
    return stripTrailingPunctuation(collapsed);
  }

  // Cut on the last word boundary <= MAX_TITLE_LENGTH so we don't slice
  // mid-word. Fall back to a hard truncate + ellipsis when the first
  // token itself is longer than the cap.
  const window = collapsed.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = window.lastIndexOf(" ");
  const base =
    lastSpace > 20 ? window.slice(0, lastSpace) : window.slice(0, MAX_TITLE_LENGTH - 1);
  return `${stripTrailingPunctuation(base)}…`;
}

// ASCII sentence terminators + ellipsis + common CJK punctuation
// (Japanese 「。」「、」, Chinese 「，」「！」「？」). We deliberately
// avoid `\p{P}` because it would also strip closing brackets / quotes
// — a question like `How do I refund (see docs)?` should keep the
// `)` and only lose the `?`.
const TRAILING_PUNCTUATION_RE =
  /[.,;:!?…。、，！？．：；]+$/u;

function stripTrailingPunctuation(input: string): string {
  return input.replace(TRAILING_PUNCTUATION_RE, "").trim();
}
