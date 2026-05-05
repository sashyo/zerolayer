"use client";

/**
 * Minimal Discord-style markdown renderer.
 *
 * Supported (intentionally narrow):
 *   ```fenced code blocks```
 *   `inline code`
 *   **bold**, __bold__
 *   *italic*, _italic_
 *   ~~strike~~
 *   ||spoiler||  (click to reveal)
 *   @username    (mention pill)
 *   bare URLs → links
 *
 * No third-party deps; tokenization is line-based for fenced blocks, then
 * span-based with regex for everything else. Anything not matched renders as
 * plaintext, so unsupported markdown shows as you typed it.
 *
 * The plaintext we receive is *already decrypted*; this component never sees
 * ciphertext.
 */
import { Fragment, useState, type ReactNode } from "react";
import { highlight, TOKEN_CLASS } from "@/lib/syntax";

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;
const MD_LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
const MENTION_RE = /(^|[\s(])@([A-Za-z0-9_.-]{1,32})/g;
const BROADCAST_MENTION_RE = /(^|[\s(])(@everyone|@here)\b/g;
// Discord-style dynamic timestamps: <t:UNIX:STYLE> where STYLE is one of
// t (short time), T (long time), d (short date), D (long date),
// f (short datetime), F (long datetime), R (relative).
const TIMESTAMP_RE = /<t:(\d{1,11})(?::([tTdDfFR]))?>/g;

interface MessageContentProps {
  text: string;
}

export function MessageContent({ text }: MessageContentProps) {
  return <>{renderBlocks(text)}</>;
}

// ── Block-level: split out fenced code blocks ────────────────────────────────

function renderBlocks(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = src.split(/(```[\s\S]*?```)/g);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (part.startsWith("```") && part.endsWith("```") && part.length >= 6) {
      const inner = part.slice(3, -3).replace(/^\n/, "").replace(/\n$/, "");
      const newlineIdx = inner.indexOf("\n");
      const lang = newlineIdx >= 0 ? inner.slice(0, newlineIdx).trim() : "";
      const body = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner;
      const tokens = highlight(body, lang);
      out.push(
        <pre
          key={i}
          className="my-1 overflow-x-auto rounded-md bg-surface-100 px-3 py-2 font-mono text-xs text-[#dcddde]"
        >
          {lang && (
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted">
              {lang}
            </span>
          )}
          <code>
            {tokens.map((t, ti) => {
              const cls = TOKEN_CLASS[t.kind];
              return cls ? (
                <span key={ti} className={cls}>
                  {t.text}
                </span>
              ) : (
                <Fragment key={ti}>{t.text}</Fragment>
              );
            })}
          </code>
        </pre>,
      );
    } else {
      // Walk line-by-line so we can lift block-level constructs (headings,
      // blockquotes, lists) out of the otherwise inline-rendered prose.
      // Consecutive matching block lines fold into a single element.
      const lines = part.split(/\n/);
      const buffer: string[] = [];
      const quoteBuffer: string[] = [];
      type ListItem = { ordered: boolean; text: string };
      const listBuffer: ListItem[] = [];
      const flushBuffer = (k: string) => {
        if (buffer.length === 0) return;
        const joined = buffer.join("\n");
        out.push(<Fragment key={k}>{renderInline(joined)}</Fragment>);
        buffer.length = 0;
      };
      const flushQuote = (k: string) => {
        if (quoteBuffer.length === 0) return;
        const joined = quoteBuffer.join("\n");
        out.push(
          <blockquote
            key={k}
            className="my-1 border-l-4 border-surface-100 pl-3 text-[#dcddde]"
          >
            {renderInline(joined)}
          </blockquote>,
        );
        quoteBuffer.length = 0;
      };
      const flushList = (k: string) => {
        if (listBuffer.length === 0) return;
        const ordered = listBuffer[0].ordered;
        const Tag = ordered ? "ol" : "ul";
        out.push(
          <Tag
            key={k}
            className={
              ordered
                ? "my-1 list-decimal pl-6"
                : "my-1 list-disc pl-6"
            }
          >
            {listBuffer.map((it, idx) => (
              <li key={`${k}-${idx}`}>{renderInline(it.text)}</li>
            ))}
          </Tag>,
        );
        listBuffer.length = 0;
      };
      // Helper: a line that *looks* like a table row.
      const tableRow = (s: string) => /^\s*\|.+\|\s*$/.test(s);
      const splitRow = (s: string) =>
        s
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());

      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        // Try to absorb a 2+ row table starting here:
        // | h | h |
        // |---|---|
        // | c | c |
        if (tableRow(line) && li + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[li + 1])) {
          flushBuffer(`${i}-pre-t-${li}`);
          flushQuote(`${i}-q-t-${li}`);
          flushList(`${i}-l-t-${li}`);
          const headers = splitRow(line);
          const rows: string[][] = [];
          let j = li + 2;
          while (j < lines.length && tableRow(lines[j])) {
            rows.push(splitRow(lines[j]));
            j += 1;
          }
          out.push(
            <div key={`${i}-t-${li}`} className="my-1 overflow-x-auto">
              <table className="border-collapse text-sm">
                <thead>
                  <tr>
                    {headers.map((h, hi) => (
                      <th
                        key={hi}
                        className="border border-surface-100 bg-surface-100/40 px-2 py-1 text-left font-semibold text-white"
                      >
                        {renderInline(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => (
                        <td
                          key={ci}
                          className="border border-surface-100 px-2 py-1 text-[#dcddde]"
                        >
                          {renderInline(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>,
          );
          li = j - 1;
          continue;
        }
        const heading = /^(#{1,3})\s+(.+)$/.exec(line);
        const quote = /^>\s?(.*)$/.exec(line);
        const bullet = /^[-*]\s+(.+)$/.exec(line);
        const numbered = /^\d+\.\s+(.+)$/.exec(line);
        if (heading) {
          flushBuffer(`${i}-pre-${li}`);
          flushQuote(`${i}-q-${li}`);
          flushList(`${i}-l-${li}`);
          const level = heading[1].length;
          const inner = heading[2];
          const cls =
            level === 1
              ? "mt-2 text-xl font-bold text-white"
              : level === 2
                ? "mt-2 text-lg font-bold text-white"
                : "mt-1 text-base font-semibold text-white";
          out.push(
            <div key={`${i}-h-${li}`} className={cls}>
              {renderInline(inner)}
            </div>,
          );
        } else if (quote) {
          flushBuffer(`${i}-pre-q-${li}`);
          flushList(`${i}-l-q-${li}`);
          if (quoteBuffer.length > 0) quoteBuffer.push("\n");
          quoteBuffer.push(quote[1]);
        } else if (bullet || numbered) {
          flushBuffer(`${i}-pre-l-${li}`);
          flushQuote(`${i}-q-l-${li}`);
          const ordered = !!numbered;
          // Mixing styles flushes the previous list so the markup is honest.
          if (listBuffer.length > 0 && listBuffer[0].ordered !== ordered) {
            flushList(`${i}-l-mix-${li}`);
          }
          listBuffer.push({ ordered, text: (bullet ?? numbered)![1] });
        } else {
          flushQuote(`${i}-q-${li}`);
          flushList(`${i}-l-${li}`);
          if (buffer.length > 0) buffer.push("\n");
          buffer.push(line);
        }
      }
      flushQuote(`${i}-q-tail`);
      flushList(`${i}-l-tail`);
      flushBuffer(`${i}-tail`);
    }
  }
  return out;
}

// ── Inline-level: bold, italic, strike, inline-code, urls ────────────────────

function renderInline(src: string): ReactNode[] {
  // Pull out backtick-inline-code first so its contents don't get formatted.
  const out: ReactNode[] = [];
  const codeParts = src.split(/(`[^`\n]+`)/g);
  for (let i = 0; i < codeParts.length; i++) {
    const part = codeParts[i];
    if (!part) continue;
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      out.push(
        <code
          key={`c-${i}`}
          className="rounded bg-surface-100 px-1 py-0.5 font-mono text-[0.85em] text-[#dcddde]"
        >
          {part.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(...renderEmphasis(part, `e-${i}`));
    }
  }
  return out;
}

function renderEmphasis(src: string, keyPrefix: string): ReactNode[] {
  // Order matters: strikethrough → bold → italic → urls.
  // Each pass preserves the React tree by splitting its regex into match/non-match groups.
  type Token = string | ReactNode;
  let tokens: Token[] = [src];

  tokens = expand(tokens, /\|\|([^|\n]+)\|\|/g, (m, k) => (
    <Spoiler key={k}>{m[1]}</Spoiler>
  ));
  tokens = expand(tokens, /~~([^~\n]+)~~/g, (m, k) => (
    <s key={k} className="line-through">{m[1]}</s>
  ));
  tokens = expand(tokens, /\*\*([^*\n]+)\*\*/g, (m, k) => (
    <strong key={k} className="font-semibold">{m[1]}</strong>
  ));
  tokens = expand(tokens, /__([^_\n]+)__/g, (m, k) => (
    <strong key={k} className="font-semibold">{m[1]}</strong>
  ));
  tokens = expand(tokens, /\*([^*\n]+)\*/g, (m, k) => (
    <em key={k} className="italic">{m[1]}</em>
  ));
  tokens = expand(tokens, /_([^_\n]+)_/g, (m, k) => (
    <em key={k} className="italic">{m[1]}</em>
  ));
  // Discord-style <t:unix:STYLE> dynamic timestamps. We render them inline
  // as a pill with the formatted time and the absolute datetime in `title`.
  tokens = expand(tokens, TIMESTAMP_RE, (m, k) => {
    const ts = Number(m[1]);
    const style = (m[2] ?? "f") as "t" | "T" | "d" | "D" | "f" | "F" | "R";
    return (
      <span
        key={k}
        className="rounded bg-surface-100 px-1 text-[#dcddde]"
        title={new Date(ts * 1000).toLocaleString()}
      >
        {formatDiscordTimestamp(ts, style)}
      </span>
    );
  });
  // Markdown link [text](url) — runs BEFORE bare-URL detection so the bare
  // URL pass doesn't double-link anything inside the parens.
  tokens = expand(tokens, MD_LINK_RE, (m, k) => (
    <a
      key={k}
      href={m[2]}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand underline-offset-2 hover:underline"
    >
      {m[1]}
    </a>
  ));
  tokens = expand(tokens, URL_RE, (m, k) => (
    <a
      key={k}
      href={m[0]}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand underline-offset-2 hover:underline"
    >
      {m[0]}
    </a>
  ));
  // @everyone / @here render as a louder yellow pill — runs BEFORE the
  // generic mention regex so we don't mistake them for usernames.
  tokens = expand(tokens, BROADCAST_MENTION_RE, (m, k) => (
    <Fragment key={k}>
      {m[1]}
      <span className="rounded bg-yellow-400/20 px-1 font-semibold text-yellow-300">
        {m[2]}
      </span>
    </Fragment>
  ));
  // Mentions render as a clickable brand-tinted pill. The leading
  // whitespace/paren is preserved so surrounding spacing doesn't get eaten.
  // Click dispatches a global event the active server's view picks up to
  // resolve the username → user and open the profile popover.
  tokens = expand(tokens, MENTION_RE, (m, k) => (
    <Fragment key={k}>
      {m[1]}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("zl:mention-click", {
              detail: { username: m[2] },
            }),
          );
        }}
        className="rounded bg-brand/20 px-1 font-medium text-brand hover:bg-brand/30"
      >
        @{m[2]}
      </button>
    </Fragment>
  ));

  return tokens.map((t, i) =>
    typeof t === "string" ? (
      <Fragment key={`${keyPrefix}-t-${i}`}>{t}</Fragment>
    ) : (
      <Fragment key={`${keyPrefix}-r-${i}`}>{t}</Fragment>
    ),
  );
}

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={(e) => {
        if (!revealed) {
          e.stopPropagation();
          setRevealed(true);
        }
      }}
      className={
        revealed
          ? "rounded bg-surface-100/60 px-1"
          : "cursor-pointer rounded bg-surface-100 px-1 text-surface-100 hover:bg-surface-100/80 select-none"
      }
      title={revealed ? undefined : "Click to reveal spoiler"}
    >
      {children}
    </span>
  );
}

function expand(
  tokens: Array<string | ReactNode>,
  re: RegExp,
  render: (match: RegExpExecArray, key: string) => ReactNode,
): Array<string | ReactNode> {
  const out: Array<string | ReactNode> = [];
  let kSuffix = 0;
  for (const t of tokens) {
    if (typeof t !== "string") {
      out.push(t);
      continue;
    }
    let last = 0;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      if (m.index > last) out.push(t.slice(last, m.index));
      out.push(render(m, `m-${kSuffix++}`));
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex += 1;
    }
    if (last < t.length) out.push(t.slice(last));
  }
  return out;
}

function formatDiscordTimestamp(
  unixSeconds: number,
  style: "t" | "T" | "d" | "D" | "f" | "F" | "R",
): string {
  const d = new Date(unixSeconds * 1000);
  if (style === "R") return relativeFromNow(d);
  if (style === "t")
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (style === "T")
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  if (style === "d")
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
  if (style === "D")
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  if (style === "F")
    return d.toLocaleString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  // default + "f"
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relativeFromNow(d: Date): string {
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const past = diffMs < 0;
  const units: Array<{ ms: number; label: string }> = [
    { ms: 365 * 24 * 3600_000, label: "year" },
    { ms: 30 * 24 * 3600_000, label: "month" },
    { ms: 7 * 24 * 3600_000, label: "week" },
    { ms: 24 * 3600_000, label: "day" },
    { ms: 3600_000, label: "hour" },
    { ms: 60_000, label: "minute" },
    { ms: 1_000, label: "second" },
  ];
  for (const u of units) {
    if (abs >= u.ms) {
      const n = Math.floor(abs / u.ms);
      const plural = n === 1 ? "" : "s";
      return past ? `${n} ${u.label}${plural} ago` : `in ${n} ${u.label}${plural}`;
    }
  }
  return "just now";
}
