"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  User,
} from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
 * Global "Ask AI" drawer — a compact, one-click surface to reach the
 * ControlDesk chatbot from anywhere in the app.
 *
 * Design goals (vs the full-page `HelpAskPanel` on `/help`):
 *   • Always one click away from the topbar; no navigation required.
 *   • Personalised greeting so the user feels the assistant is "theirs".
 *   • Suggestion chips replace the bullet list — one tap sends the
 *     prompt straight to the API, matching the Hostinger UX the
 *     product spec references.
 *   • NO history sidebar. Every open is a fresh conversation. Users
 *     who want history navigate to `/help?tab=ask` where the full
 *     panel is (deliberately different mental model: this drawer is
 *     "quick help", `/help` is "deep help").
 *   • Reuses the same `/api/help/ask` streaming endpoint the full
 *     panel does, so backend rate-limit / quota / tool-calling logic
 *     stays a single source of truth.
 *
 * Client-owned state — the sheet is unmounted when closed, so a fresh
 * open really is a fresh conversation. `crypto.randomUUID` gives us
 * a stable id for the multi-turn thread the server persists to
 * `tenant_chat_conversations`.
 */

type Msg = { id: string; role: "user" | "assistant"; content: string };

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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * First name pulled from the current employee's `full_name`. Used
   * for the greeting only; the backend already knows who the user is
   * via the session cookie.
   */
  firstName: string;
  /**
   * Slug allowlist for citation rewrite — same contract as the full
   * `HelpAskPanel`. Passed in from the topbar RSC parent so the
   * client bundle doesn't ship an inline article manifest.
   */
  articleSlugs: readonly string[];
};

export function AskAiSheet({
  open,
  onOpenChange,
  firstName,
  articleSlugs,
}: Props) {
  const t = useTranslations("askAi");
  const tShared = useTranslations("help.ask");

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<ErrorKind>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [conversationId, setConversationId] = useState<string>(() =>
    randomUuid(),
  );
  // RAG-only fallback state. `lastQueryRef` captures the most recent
  // user-submitted question so we can re-issue it against the pure
  // retrieval endpoint when the LLM path fails — without this, the
  // "Show related docs" button has no query to run against. `null`
  // means the user hasn't asked for the fallback yet; `[]` means we
  // asked and got zero hits (rendered as a friendly empty state).
  const [fallbackArticles, setFallbackArticles] = useState<
    RagArticle[] | null
  >(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const lastQueryRef = useRef<string>("");

  // Reset transient state when the drawer closes so the next open is
  // a clean slate. We intentionally DO NOT abort in-flight streams on
  // close — closing the sheet mid-stream should preserve the reply on
  // the server side (already persisted per token in the endpoint) so
  // a user who reopens later still finds their prior thread in
  // `/help` history.
  useEffect(() => {
    if (!open) {
      // Close-time cleanup: reset every piece of transient state so
      // the next open is a fresh conversation. Lint disable applies
      // to the whole block — `react-hooks/set-state-in-effect` is a
      // conservative rule that fires on ANY setState in an effect
      // body, but this specific pattern (batch reset on unmount-like
      // transition) doesn't cascade because the sheet unmounts its
      // children immediately after `open` flips to false. The
      // alternative (moving these into an `onOpenChange` handler)
      // works but couples the "when to reset" decision to every
      // caller of `onOpenChange` (Radix internals include a11y
      // escape, backdrop click, close button) which is fragile.
      /* eslint-disable react-hooks/set-state-in-effect */
      setMessages([]);
      setInput("");
      setError(null);
      setConversationId(randomUuid());
      setFallbackArticles(null);
      setFallbackLoading(false);
      /* eslint-enable react-hooks/set-state-in-effect */
      lastQueryRef.current = "";
      abortRef.current?.abort();
    }
  }, [open]);

  // Auto-focus the textarea when the drawer opens. The Sheet's own
  // `initialFocus` prop is on the close button by default — swapping
  // it for our input on mount is the friendlier default for a chat
  // surface: the user always meant to type something.
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 120);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  // Auto-scroll on new token.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "auto",
    });
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      setError(null);
      // Every new turn resets the fallback state — the user has moved
      // on, and any prior "show related docs" cards belonged to a
      // different question. `lastQueryRef` captures the fresh query
      // so the fallback fetch (below, in `showFallback`) has the
      // right seed.
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

      // Cap to the newest 10 turns (matches the API `.max(20)` guard).
      const history = nextMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .filter(
          (m) => m.content.trim().length > 0 || m.id !== assistantId,
        )
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content || " " }));

      try {
        const res = await fetch("/api/help/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            conversationId,
            useTools: true,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          setError(classifyError(res));
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
        // with a spinner forever ("muter-muter terus" — reported bug).
        // Trim guard is defensive against a lone `\n` or space arriving
        // as a "response" from a badly-behaved provider.
        if (acc.trim().length === 0) {
          setError("empty_response");
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setError("network");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming, conversationId],
  );

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void send(input);
  };

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
    setConversationId(randomUuid());
    inputRef.current?.focus();
  }, []);

  const showFallback = useCallback(async () => {
    const query = lastQueryRef.current;
    // Guard: without a captured query there's nothing to retrieve
    // against. Shouldn't happen in practice — the fallback button is
    // only rendered after a `send()` call — but keeps the fetch
    // contract clean.
    if (!query || fallbackLoading) return;
    setFallbackLoading(true);
    try {
      const articles = await fetchRagFallback(query, { limit: 3 });
      setFallbackArticles(articles);
    } catch {
      // Retrieval itself failing is very rare (static index, no DB
      // needed). We fall back to an empty array so the card renders
      // its "no results" state — better than silently doing nothing.
      setFallbackArticles([]);
    } finally {
      setFallbackLoading(false);
    }
  }, [fallbackLoading]);

  // Three curated suggestion prompts — pulled from the existing
  // `help.ask.suggestion*` translation namespace so a single edit in
  // messages/{lang}.json updates both surfaces. Chip click → send
  // straight through the same `send()` path a manual submit takes.
  const suggestions = [
    tShared("suggestion1"),
    tShared("suggestion2"),
    tShared("suggestion3"),
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        {/* Gradient header — echoes the trigger pill's aesthetic and
            gives the assistant a distinct "AI-native" surface (vs the
            neutral chrome elsewhere in the app). Uses the same
            indigo/violet/sky palette as the post-login splash so the
            two branded moments feel consistent. */}
        <SheetHeader className="border-b bg-gradient-to-br from-indigo-500/10 via-violet-500/10 to-sky-500/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div
              aria-hidden
              className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 text-white shadow-sm shadow-indigo-500/30"
            >
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-sm font-semibold">
                {t("title")}
              </SheetTitle>
              <SheetDescription className="truncate text-xs">
                {t("subtitle")}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-5 py-4"
          role="log"
          aria-live="polite"
          aria-atomic="false"
        >
          {messages.length === 0 ? (
            <WelcomeState
              firstName={firstName}
              greeting={t("greeting", {
                name: firstName || t("greetingFallback"),
              })}
              greetingSubtitle={t("greetingSubtitle")}
              suggestionsLabel={t("suggestionsLabel")}
              suggestions={suggestions}
              onSelect={(prompt) => void send(prompt)}
              disabled={streaming}
              helpHref="/help?tab=ask"
              helpLabel={t("openFullHelp")}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  slugAllowlist={articleSlugs}
                  streaming={
                    streaming &&
                    m.role === "assistant" &&
                    m.id === messages.at(-1)?.id
                  }
                />
              ))}
            </div>
          )}

          {error && (
            <ChatError
              kind={error}
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
        </div>

        <form
          onSubmit={onSubmit}
          className="border-t bg-background/90 px-5 py-3 backdrop-blur-sm"
        >
          <div className="relative">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder={t("inputPlaceholder")}
              disabled={streaming}
              className="min-h-[56px] resize-none pr-10 text-sm"
              aria-label={t("inputPlaceholder")}
            />
            <Button
              type="submit"
              size="icon-sm"
              disabled={streaming || input.trim().length === 0}
              className="absolute bottom-2 right-2 size-8"
              aria-label={streaming ? t("sending") : t("send")}
            >
              {streaming ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
            </Button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>{t("footerHint")}</span>
            {messages.length > 0 && !streaming && (
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-foreground/80 hover:bg-muted hover:text-foreground"
              >
                <RotateCcw className="size-3" aria-hidden />
                {t("reset")}
              </button>
            )}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function WelcomeState({
  firstName: _firstName,
  greeting,
  greetingSubtitle,
  suggestionsLabel,
  suggestions,
  onSelect,
  disabled,
  helpHref,
  helpLabel,
}: {
  firstName: string;
  greeting: string;
  greetingSubtitle: string;
  suggestionsLabel: string;
  suggestions: readonly string[];
  onSelect: (prompt: string) => void;
  disabled: boolean;
  helpHref: string;
  helpLabel: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="text-center">
        <div
          aria-hidden
          className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 text-white shadow-lg shadow-indigo-500/25"
        >
          <Sparkles className="size-6" />
        </div>
        <h3 className="text-base font-semibold">{greeting}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {greetingSubtitle}
        </p>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {suggestionsLabel}
        </p>
        <div className="flex flex-col gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSelect(suggestion)}
              disabled={disabled}
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

      <Link
        href={helpHref}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed py-2 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary"
      >
        {helpLabel}
        <ArrowUpRight className="size-3" aria-hidden />
      </Link>
    </div>
  );
}

function MessageBubble({
  message,
  slugAllowlist,
  streaming,
}: {
  message: Msg;
  slugAllowlist: readonly string[];
  streaming: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-2.5", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-gradient-to-br from-indigo-500/20 via-violet-500/20 to-sky-500/20 text-primary",
        )}
        aria-hidden
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted",
        )}
      >
        {message.content ? (
          isUser ? (
            <p className="whitespace-pre-wrap break-words">
              {message.content}
            </p>
          ) : (
            <div className="whitespace-pre-wrap break-words">
              {renderWithCitations(message.content, slugAllowlist)}
            </div>
          )
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

// Same citation rewrite pattern as `HelpAskPanel` — keep them in sync
// if you ever change the model's inline citation format.
function renderWithCitations(
  content: string,
  slugAllowlist: readonly string[],
): React.ReactNode[] {
  const allow = new Set(slugAllowlist);
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
    if (slug && allow.has(slug)) {
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
  onShowFallback,
  fallbackRequested,
}: {
  kind: Exclude<ErrorKind, null>;
  onShowFallback: () => void;
  fallbackRequested: boolean;
}) {
  const t = useTranslations("help.ask");
  const tFallback = useTranslations("help.ask.fallback");
  const titleKey = `error.${kind}Title` as const;
  const bodyKey = `error.${kind}Body` as const;
  // Only surface the RAG fallback for failure modes where the request
  // itself made it TO the LLM but couldn't get an answer out
  // (upstream provider issue). It's the wrong UX for `rate_limited`
  // (user is being throttled on OUR side — retrieval doesn't help
  // them chat again any sooner) and `quota_exceeded` (tenant hit its
  // daily budget — surfacing docs quietly disguises a billing signal
  // the admin needs to see). Everywhere else it's a strict upgrade.
  const supportsFallback =
    kind === "empty_response" ||
    kind === "network" ||
    kind === "not_configured";
  return (
    <Alert variant="destructive" role="alert" className="mt-4">
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

function classifyError(res: Response): ErrorKind {
  if (res.status === 429) return "rate_limited";
  if (res.status === 402) return "quota_exceeded";
  if (res.status === 503) return "not_configured";
  return "network";
}

function randomUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  const hex = [
    ...Array.from({ length: 8 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ),
  ].join("");
  return `${hex.slice(0, 8)}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-a${hex.slice(1, 4)}-${hex.slice(0, 12)}`;
}
