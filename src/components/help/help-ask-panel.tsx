"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowUpRight,
  Bot,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  fetchRagFallback,
  RagFallbackCard,
  type RagArticle,
} from "./rag-fallback-card";

/**
 * "Ask ControlDesk" chat panel — the client half of the Fase-2
 * chatbot. Renders inside the AskAI tab on `/help`.
 *
 * Design notes:
 *   • History-aware. Past conversations live in
 *     `tenant_chat_conversations` (migration 0085) and are hydrated
 *     into a left-hand sidebar so users can resume prior threads
 *     instead of losing context on every reload. `activeId` tracks
 *     which conversation the composer is talking to.
 *   • Streams from `/api/help/ask` via plain fetch + ReadableStream —
 *     no @ai-sdk/react dep. Keeps the surface minimal and avoids
 *     shipping the SDK's client bundle to every user who never uses
 *     the chatbot.
 *   • Renders assistant citations `[slug]` as inline links to the
 *     matching help article. Slug allowlist comes from the article
 *     manifest, so a hallucinated link points at a valid /help/{slug}
 *     or falls back to a plain span.
 *   • Rate-limit / budget / configuration errors are surfaced with a
 *     specific message — users need to know if it's their fault
 *     (429 = too fast) vs the workspace's (503 = admin needs to
 *     configure AI) vs quota (402).
 */

type Msg = { id: string; role: "user" | "assistant"; content: string };

type ConversationSummary = {
  id: string;
  title: string | null;
  updated_at: string;
  message_count: number;
};

type ErrorKind =
  | "rate_limited"
  | "quota_exceeded"
  | "not_configured"
  | "network"
  /**
   * Upstream LLM returned HTTP 200 but zero tokens — commonly a
   * provider-side rate-limit (Groq TPD cap, OpenAI RPM cap) whose
   * error body arrives AFTER the SDK has already committed to a 200
   * status. Also fires on truly empty completions and transient
   * provider outages that close the stream cleanly. Users see this
   * as a spinner that never terminates unless we surface the failure.
   */
  | "empty_response"
  | null;

type Props = {
  /**
   * Slug allowlist for citation rewrite. Passed from the RSC page
   * so we never encourage the model to link to an article that
   * doesn't exist.
   */
  articleSlugs: readonly string[];
};

export function HelpAskPanel({ articleSlugs }: Props) {
  const t = useTranslations("help.ask");
  // Cast the strongly-typed translator down to a plain
  // `(key, values?) => string` to keep the tsc instantiation cheap
  // when we pass `{ count }` for plural resolution.
  const tHistory = useTranslations("help.ask.history") as HistoryTranslator;
  const locale = useLocale();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<ErrorKind>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Slug allowlist derives from the prop — not a ref, since useRef
  // access during render trips the react-compiler lint rule and the
  // set is stable per render anyway (props ref-equal for the panel's
  // lifetime).
  const slugSet = useMemo(() => new Set(articleSlugs), [articleSlugs]);
  // A stable client-owned uuid that identifies THIS conversation
  // across the send() cycle. The server upserts a conversation row
  // keyed by this uuid on first message, so multi-turn threads
  // persist to `tenant_chat_messages` under one parent id.
  //
  // Regenerated on `reset()` — a new conversation is a new uuid.
  const [conversationId, setConversationId] = useState<string>(() => randomUuid());
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  // Initial value is `true` because the mount effect below immediately
  // fetches. Starting at `false` would flash "empty state" for a beat.
  // React 19 also refuses `setHistoryLoading(true)` synchronously
  // inside `refreshHistory` when called from an effect (cascading
  // render lint), so keeping the "loading" latch here and only
  // resetting it after the fetch resolves side-steps the rule.
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [hydratingId, setHydratingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Toggle the sidebar on narrow viewports where 100% chat width is
  // more valuable than a permanently visible list.
  const [historyOpenMobile, setHistoryOpenMobile] = useState(false);
  // RAG-only fallback state — mirror of the same pattern in
  // `AskAiSheet`. `lastQueryRef` captures the most recent user
  // submission so the fallback fetch has a query to run against
  // without us having to walk the message log. `fallbackArticles` is
  // `null` until the user opts in via the "Show related docs" button;
  // an empty array (after fetch) renders the friendly "no results"
  // card instead of hiding it. Reset on `reset()` and on
  // `resumeConversation()` — a resumed thread belongs to a different
  // question.
  const [fallbackArticles, setFallbackArticles] = useState<
    RagArticle[] | null
  >(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const lastQueryRef = useRef<string>("");

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/help/conversations", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        setHistoryError(tHistory("loadFailed"));
        return;
      }
      const payload: { conversations?: ConversationSummary[] } = await res.json();
      setConversations(payload.conversations ?? []);
      setHistoryError(null);
    } catch {
      setHistoryError(tHistory("loadFailed"));
    } finally {
      setHistoryLoading(false);
    }
  }, [tHistory]);

  // Mount-triggered fetch of chat history. All setState calls inside
  // `refreshHistory` happen AFTER `await fetch(...)`, not synchronously
  // in the effect body, so no cascading render can actually occur.
  // React 19's `react-hooks/set-state-in-effect` lint uses a
  // conservative heuristic — any function whose implementation
  // touches setState is flagged if called from an effect, regardless
  // of async ordering. This is a documented false-positive; the
  // React team's own guidance in "You Might Not Need an Effect"
  // still endorses effect-based data fetching when there's no
  // server-rendered starting state (which is our case — history is
  // per-user + per-tenant, no viable RSC prefetch).
  //
  // Alternatives considered + rejected:
  //   • `use()` + Suspense — would require restructuring the parent
  //     tabbed layout and losing the graceful "show empty then load"
  //     UX we depend on for the mobile drawer.
  //   • Fetch in an RSC parent and pass an initial snapshot — the
  //     panel is deeply nested under a client tabs shell; plumbing
  //     the snapshot down would require a Context provider just for
  //     this one field.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see block comment above
    void refreshHistory();
  }, [refreshHistory]);

  // Auto-scroll the log to the bottom on every new token so the user
  // sees the latest reply. `behavior: "auto"` (not "smooth") because
  // 30+ scrolls/sec of "smooth" animations is jarring.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "auto",
    });
  }, [messages]);

  // Abort any in-flight stream when the panel unmounts (tab switch,
  // navigation). Prevents dangling fetch that would still charge
  // tokens on the server if it kept streaming.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      setError(null);
      // Reset RAG fallback state on every new turn. Any prior "show
      // related docs" cards belonged to a different question; leaving
      // them mounted would be confusing.
      setFallbackArticles(null);
      setFallbackLoading(false);
      lastQueryRef.current = trimmed;
      const now = Date.now();
      const userMsg: Msg = {
        id: `u-${now}`,
        role: "user",
        content: trimmed,
      };
      const assistantId = `a-${now}`;
      const nextMessages: Msg[] = [
        ...messages,
        userMsg,
        { id: assistantId, role: "assistant", content: "" },
      ];
      setMessages(nextMessages);
      setInput("");
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      // Send the full transcript so the model has conversational
      // context. Slice to the newest 10 turns to keep prompt sizes
      // bounded — matches the API-side `.max(20)` guard on messages.
      const history = nextMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .filter((m) => m.content.trim().length > 0 || m.id !== assistantId)
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content || " " }));

      try {
        const res = await fetch("/api/help/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            conversationId,
            // Opt into Level 2 tool calling. Server further guards
            // by refusing tool access when conversationId is missing
            // OR when the tenant lacks AI config (falls back to L1).
            useTools: true,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const kind = await classifyError(res);
          setError(kind);
          // Drop the empty assistant placeholder from the transcript
          // so the log doesn't show a blank bubble.
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          return;
        }
        if (!res.body) {
          setError("network");
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: acc } : m,
            ),
          );
        }

        // Empty-stream guard: HTTP 200 + zero tokens usually means the
        // upstream provider (Groq / OpenAI) hit ITS OWN rate limit
        // AFTER the AI SDK opened the response — the error body lands
        // in the AI SDK's internal logs but never reaches this reader.
        // Without this check the assistant placeholder stays visible
        // with a spinner forever ("muter-muter terus" — reported bug,
        // same fix mirrored in AskAiSheet).
        if (acc.trim().length === 0) {
          setError("empty_response");
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          return;
        }

        // Refresh sidebar so the new conversation (or updated timestamp
        // on a resumed one) shows up. Fire-and-forget — the chat
        // itself is already visible; a slow history call shouldn't
        // block interaction.
        void refreshHistory();
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setError("network");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming, conversationId, refreshHistory],
  );

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void send(input);
  };

  // Enter to send, Shift+Enter for newline — the norm across chat
  // UIs. Ignored when streaming so users don't spam mid-response.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!streaming) void send(input);
    }
  };

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setFallbackArticles(null);
    setFallbackLoading(false);
    lastQueryRef.current = "";
    // Fresh conversation id → server creates a new parent row and
    // history for the next turn stops carrying the prior context.
    setConversationId(randomUuid());
    setHistoryOpenMobile(false);
  }, []);

  const showFallback = useCallback(async () => {
    const query = lastQueryRef.current;
    if (!query || fallbackLoading) return;
    setFallbackLoading(true);
    try {
      const articles = await fetchRagFallback(query, { limit: 3 });
      setFallbackArticles(articles);
    } catch {
      // Retrieval failure is very rare (static index, no DB needed).
      // Fall through to empty array so the card renders its "no
      // results" state — better UX than a silent no-op.
      setFallbackArticles([]);
    } finally {
      setFallbackLoading(false);
    }
  }, [fallbackLoading]);

  const resumeConversation = useCallback(
    async (id: string) => {
      if (streaming || hydratingId) return;
      // Ignore no-ops so clicking the active thread doesn't refetch.
      if (id === conversationId) {
        setHistoryOpenMobile(false);
        return;
      }
      setHydratingId(id);
      setHistoryError(null);
      abortRef.current?.abort();
      try {
        const res = await fetch(
          `/api/help/conversations/${encodeURIComponent(id)}`,
          {
            method: "GET",
            headers: { Accept: "application/json" },
            cache: "no-store",
          },
        );
        if (!res.ok) {
          setHistoryError(tHistory("resumeFailed"));
          return;
        }
        const payload = (await res.json()) as {
          id: string;
          title: string | null;
          messages: Array<{
            id: string;
            role: "user" | "assistant";
            content: string;
          }>;
        };
        setMessages(
          payload.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          })),
        );
        setConversationId(payload.id);
        setError(null);
        // Resumed thread belongs to a different question — drop any
        // fallback state so we don't leave stale "here are related
        // docs" cards attached to a different topic.
        setFallbackArticles(null);
        setFallbackLoading(false);
        lastQueryRef.current = "";
        setHistoryOpenMobile(false);
      } catch {
        setHistoryError(tHistory("resumeFailed"));
      } finally {
        setHydratingId(null);
      }
    },
    [conversationId, hydratingId, streaming, tHistory],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      if (deletingId) return;
      // Confirm at the browser level — no custom modal for a
      // destructive but recoverable-nearby action (the user can
      // always start a new thread).
      if (
        typeof window !== "undefined" &&
        !window.confirm(tHistory("deleteConfirm"))
      ) {
        return;
      }
      setDeletingId(id);
      try {
        const res = await fetch(
          `/api/help/conversations/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          setHistoryError(tHistory("deleteFailed"));
          return;
        }
        setConversations((prev) => prev.filter((c) => c.id !== id));
        // If the deleted thread was active, drop into a fresh
        // conversation so the composer doesn't dangle-reference a row
        // that no longer exists.
        if (id === conversationId) {
          reset();
        }
      } catch {
        setHistoryError(tHistory("deleteFailed"));
      } finally {
        setDeletingId(null);
      }
    },
    [conversationId, deletingId, reset, tHistory],
  );

  const showMobileHistoryToggle = conversations.length > 0 || historyLoading;

  return (
    <div className="flex flex-col gap-4 md:grid md:grid-cols-[16rem,1fr] md:gap-4">
      <ConversationSidebar
        className={cn(
          "md:sticky md:top-4 md:self-start",
          historyOpenMobile ? "block" : "hidden md:block",
        )}
        conversations={conversations}
        activeId={conversationId}
        loading={historyLoading}
        error={historyError}
        hydratingId={hydratingId}
        deletingId={deletingId}
        onResume={resumeConversation}
        onDelete={deleteConversation}
        onNew={reset}
        locale={locale}
        t={tHistory}
      />

      <div className="flex min-w-0 flex-col gap-4">
        {showMobileHistoryToggle && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-start md:hidden"
            onClick={() => setHistoryOpenMobile((v) => !v)}
            aria-expanded={historyOpenMobile}
            aria-label={
              historyOpenMobile
                ? tHistory("srToggleClose")
                : tHistory("srToggleOpen")
            }
          >
            <MessageSquare className="size-3.5" aria-hidden />
            {tHistory("title")}
          </Button>
        )}
        {messages.length === 0 && (
          // Empty-state polish (Aug 2026) — matches the topbar drawer
          // aesthetic so the two Ask AI surfaces read as one product,
          // not two. Gradient sparkles emblem, centered greeting,
          // clickable suggestion chips (vs the old bullet list which
          // required the user to copy-paste). Suggestions still pull
          // from the shared `help.ask.suggestion*` translation namespace
          // — edit them in one place, update both surfaces.
          <div className="rounded-xl border bg-gradient-to-br from-indigo-500/5 via-violet-500/5 to-sky-500/5 p-6 sm:p-8">
            <div className="text-center">
              <div
                aria-hidden
                className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 text-white shadow-lg shadow-indigo-500/25"
              >
                <Sparkles className="size-6" />
              </div>
              <h3 className="text-base font-semibold sm:text-lg">
                {t("welcomeTitle")}
              </h3>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
                {t("welcomeBody")}
              </p>
            </div>

            <div className="mx-auto mt-6 max-w-md">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("suggestionsLabel")}
              </p>
              <div className="flex flex-col gap-2">
                {[
                  t("suggestion1"),
                  t("suggestion2"),
                  t("suggestion3"),
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    disabled={streaming || hydratingId !== null}
                    className={cn(
                      "group flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-left text-xs leading-relaxed transition-colors",
                      "hover:border-primary/50 hover:bg-primary/5",
                      "disabled:cursor-not-allowed disabled:opacity-60",
                    )}
                  >
                    <ArrowUpRight
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                      aria-hidden
                    />
                    <span className="line-clamp-2">{suggestion}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.length > 0 && (
          <div
            ref={scrollRef}
            className="max-h-[520px] overflow-y-auto rounded-lg border bg-background"
            role="log"
            aria-live="polite"
            aria-atomic="false"
          >
            <div className="flex flex-col gap-4 p-4">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  slugAllowlist={slugSet}
                  streaming={
                    streaming &&
                    m.role === "assistant" &&
                    m.id === messages.at(-1)?.id
                  }
                />
              ))}
            </div>
          </div>
        )}

        {error && (
          <ChatError
            kind={error}
            t={t}
            onShowFallback={showFallback}
            fallbackRequested={
              fallbackArticles !== null || fallbackLoading
            }
          />
        )}
        {(fallbackLoading || fallbackArticles !== null) && (
          <RagFallbackCard
            articles={fallbackArticles ?? []}
            loading={fallbackLoading}
          />
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder={t("inputPlaceholder")}
            disabled={streaming || hydratingId !== null}
            className="resize-none"
            aria-label={t("inputPlaceholder")}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{t("footerHint")}</p>
            <div className="flex items-center gap-2">
              {messages.length > 0 && !streaming && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  {t("reset")}
                </Button>
              )}
              <Button
                type="submit"
                size="sm"
                disabled={streaming || input.trim().length === 0}
              >
                {streaming ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    {t("sending")}
                  </>
                ) : (
                  <>
                    <Send className="size-3.5" aria-hidden />
                    {t("send")}
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// Loosened translator signature. The i18n type inference blows up on
// the full message tree when passing plural values through
// `useTranslations`; a plain string-in string-out signature keeps
// TypeScript within its instantiation budget while runtime behaviour
// is unchanged (next-intl resolves keys the same way).
type HistoryTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

function ConversationSidebar({
  className,
  conversations,
  activeId,
  loading,
  error,
  hydratingId,
  deletingId,
  onResume,
  onDelete,
  onNew,
  locale,
  t,
}: {
  className?: string;
  conversations: ConversationSummary[];
  activeId: string;
  loading: boolean;
  error: string | null;
  hydratingId: string | null;
  deletingId: string | null;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  locale: string;
  t: HistoryTranslator;
}) {
  return (
    <aside
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-muted/20 p-2 md:max-h-[600px] md:overflow-y-auto",
        className,
      )}
      aria-label={t("title")}
    >
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("title")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onNew}
        >
          <Plus className="size-3" aria-hidden />
          {t("newButton")}
        </Button>
      </div>
      {error && (
        <p className="px-2 pb-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {loading && conversations.length === 0 && (
        <p className="px-2 py-4 text-xs text-muted-foreground">
          {t("loading")}
        </p>
      )}
      {!loading && conversations.length === 0 && (
        <p className="px-2 py-4 text-xs text-muted-foreground">{t("empty")}</p>
      )}
      <ul className="flex flex-col gap-1">
        {conversations.map((c) => {
          const isActive = c.id === activeId;
          const isHydrating = hydratingId === c.id;
          const isDeleting = deletingId === c.id;
          const label = c.title?.trim() || t("untitled");
          return (
            <li key={c.id} className="group relative">
              <button
                type="button"
                onClick={() => onResume(c.id)}
                disabled={isHydrating || isDeleting}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 pr-8 text-left text-xs transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted",
                  (isHydrating || isDeleting) && "opacity-60",
                )}
                aria-current={isActive ? "true" : undefined}
              >
                <span className="line-clamp-2 font-medium">{label}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("messagesCount", { count: c.message_count })} ·{" "}
                  {formatRelativeTime(c.updated_at, locale)}
                </span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
                disabled={isDeleting}
                className={cn(
                  "absolute right-1 top-1.5 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity focus:opacity-100 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100",
                  isDeleting && "opacity-100",
                )}
                aria-label={t("delete")}
                title={t("delete")}
              >
                {isDeleting ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="size-3" aria-hidden />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/**
 * Locale-aware, low-cost relative-time string. We deliberately avoid
 * bringing in `date-fns-tz` for this — the sidebar shows fuzzy
 * timestamps ("5m ago", "yesterday") and the exact instant is
 * uninteresting. `Intl.RelativeTimeFormat` is native and produces
 * both Bahasa Indonesia ("5 menit yang lalu") and English ("5 minutes
 * ago") without a translation table.
 */
function formatRelativeTime(iso: string, locale: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "";
  const diffSec = Math.round((parsed - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 604800) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 2592000)
    return rtf.format(Math.round(diffSec / 604800), "week");
  if (abs < 31536000)
    return rtf.format(Math.round(diffSec / 2592000), "month");
  return rtf.format(Math.round(diffSec / 31536000), "year");
}

/**
 * Small, dependency-free uuid v4 for conversation ids. `crypto.randomUUID`
 * is available in all modern browsers; we don't import a lib just to
 * generate a client-side id that only ever lives in memory.
 */
function randomUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for very old runtimes / SSR (SSR-only rendering never
  // actually gets here; useState initialiser runs client-side).
  const hex = [
    ...Array.from({ length: 8 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ),
  ].join("");
  return `${hex.slice(0, 8)}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-a${hex.slice(1, 4)}-${hex.slice(0, 12)}`;
}

function MessageBubble({
  message,
  slugAllowlist,
  streaming,
}: {
  message: Msg;
  slugAllowlist: Set<string>;
  streaming: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-primary/10 text-primary",
        )}
        aria-hidden
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div
        className={cn(
          "max-w-[min(80%,42rem)] rounded-lg px-3 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted",
        )}
      >
        {message.content ? (
          <MessageContent
            content={message.content}
            slugAllowlist={slugAllowlist}
            isAssistant={!isUser}
          />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            <span className="text-xs">…</span>
          </span>
        )}
        {streaming && message.content && (
          <span
            className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-current align-middle"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

/**
 * Render message content, rewriting inline citations `[slug]` to
 * `<Link href="/help/{slug}">`. Model hallucinations that don't
 * match a known slug are shown as plain text so users don't chase
 * dead links.
 */
function MessageContent({
  content,
  slugAllowlist,
  isAssistant,
}: {
  content: string;
  slugAllowlist: Set<string>;
  isAssistant: boolean;
}) {
  if (!isAssistant) {
    return (
      <p className="whitespace-pre-wrap break-words">{content}</p>
    );
  }
  const nodes = renderWithCitations(content, slugAllowlist);
  return <div className="whitespace-pre-wrap break-words">{nodes}</div>;
}

function renderWithCitations(
  content: string,
  slugAllowlist: Set<string>,
): React.ReactNode[] {
  const pattern = /\[([a-z0-9][a-z0-9-]{1,60})\]/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(content)) !== null) {
    const [full, slug] = match;
    const start = match.index;
    if (start > lastIndex) {
      nodes.push(content.slice(lastIndex, start));
    }
    if (slug && slugAllowlist.has(slug)) {
      nodes.push(
        <Link
          key={`cite-${key++}`}
          href={`/help/${slug}`}
          className="inline-flex items-center gap-0.5 rounded-sm bg-primary/10 px-1 py-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          {slug}
          <ArrowUpRight className="size-3" aria-hidden />
        </Link>,
      );
    } else {
      // Unknown slug — keep the raw text, no link.
      nodes.push(full);
    }
    lastIndex = start + full.length;
  }
  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }
  return nodes;
}

function ChatError({
  kind,
  t,
  onShowFallback,
  fallbackRequested,
}: {
  kind: Exclude<ErrorKind, null>;
  t: ReturnType<typeof useTranslations>;
  onShowFallback: () => void;
  fallbackRequested: boolean;
}) {
  const tFallback = useTranslations("help.ask.fallback");
  const titleKey = `error.${kind}Title` as const;
  const bodyKey = `error.${kind}Body` as const;
  // Only surface the RAG fallback for failure modes where the LLM
  // itself couldn't answer, not for OUR rate-limit / quota controls.
  // Same allowlist as the drawer — keeps the two surfaces
  // behaviourally identical so support runbooks don't fork.
  const supportsFallback =
    kind === "empty_response" ||
    kind === "network" ||
    kind === "not_configured";
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>{t(titleKey)}</AlertTitle>
      <AlertDescription>
        <p>{t(bodyKey)}</p>
        {supportsFallback && !fallbackRequested && (
          <div className="mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onShowFallback}
              className="h-7 gap-1.5 text-xs"
            >
              <Sparkles className="size-3" aria-hidden />
              {tFallback("showRelatedDocs")}
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

async function classifyError(res: Response): Promise<ErrorKind> {
  if (res.status === 429) return "rate_limited";
  if (res.status === 402) return "quota_exceeded";
  if (res.status === 503) return "not_configured";
  return "network";
}
