"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ArrowUpRight, Bot, Loader2, RotateCcw, Send, User } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * "Ask ControlDesk" chat panel — the client half of the Fase-2
 * chatbot. Renders inside the AskAI tab on `/help`.
 *
 * Design notes:
 *   • Ephemeral by design (user's Fase-2 choice). Messages live in
 *     component state; refresh wipes the conversation. Nothing hits
 *     the DB.
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

type ErrorKind =
  | "rate_limited"
  | "quota_exceeded"
  | "not_configured"
  | "network"
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
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<ErrorKind>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const slugSet = useRef(new Set(articleSlugs));

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
          body: JSON.stringify({ messages: history }),
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
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setError("network");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming],
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

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 && (
        <div className="rounded-lg border bg-muted/30 p-6 text-sm">
          <div className="flex items-start gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
              <Bot className="size-4" aria-hidden />
            </div>
            <div className="flex-1">
              <p className="font-medium">{t("welcomeTitle")}</p>
              <p className="mt-1 text-muted-foreground">
                {t("welcomeBody")}
              </p>
              <ul className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground">
                <li>• {t("suggestion1")}</li>
                <li>• {t("suggestion2")}</li>
                <li>• {t("suggestion3")}</li>
              </ul>
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
                slugAllowlist={slugSet.current}
                streaming={
                  streaming && m.role === "assistant" && m.id === messages.at(-1)?.id
                }
              />
            ))}
          </div>
        </div>
      )}

      {error && <ChatError kind={error} t={t} />}

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={t("inputPlaceholder")}
          disabled={streaming}
          className="resize-none"
          aria-label={t("inputPlaceholder")}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {t("footerHint")}
          </p>
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
  );
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
}: {
  kind: Exclude<ErrorKind, null>;
  t: ReturnType<typeof useTranslations>;
}) {
  const titleKey = `error.${kind}Title` as const;
  const bodyKey = `error.${kind}Body` as const;
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>{t(titleKey)}</AlertTitle>
      <AlertDescription>{t(bodyKey)}</AlertDescription>
    </Alert>
  );
}

async function classifyError(res: Response): Promise<ErrorKind> {
  if (res.status === 429) return "rate_limited";
  if (res.status === 402) return "quota_exceeded";
  if (res.status === 503) return "not_configured";
  return "network";
}
