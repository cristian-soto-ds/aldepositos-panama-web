"use client";

import React, { useMemo } from "react";

/**
 * Renderiza Markdown básico de chat (negritas, títulos, listas)
 * sin mostrar los símbolos crudos (** ## -).
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // **negrita**, *cursiva*, `código`
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-slate-900 dark:text-slate-50">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-slate-200/80 px-1 py-0.5 font-mono text-[0.85em] dark:bg-slate-700/80"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(token);
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { type: "h"; level: 1 | 2 | 3; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "p"; text: string };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push({
        type: "h",
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!.trim(),
      });
      i += 1;
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const t = (lines[i] ?? "").trim();
        const m = /^[-*•]\s+(.+)$/.exec(t);
        if (!m) break;
        items.push(m[1]!.trim());
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const t = (lines[i] ?? "").trim();
        const m = /^\d+[.)]\s+(.+)$/.exec(t);
        if (!m) break;
        items.push(m[1]!.trim());
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const para: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const t = (lines[i] ?? "").trim();
      if (
        !t ||
        /^(#{1,3})\s+/.test(t) ||
        /^[-*•]\s+/.test(t) ||
        /^\d+[.)]\s+/.test(t)
      ) {
        break;
      }
      para.push(t);
      i += 1;
    }
    blocks.push({ type: "p", text: para.join(" ") });
  }

  return blocks;
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: "mb-2 mt-3 text-base font-bold text-slate-900 first:mt-0 dark:text-slate-50",
  2: "mb-1.5 mt-3 text-[0.95rem] font-bold text-slate-900 first:mt-0 dark:text-slate-50",
  3: "mb-1 mt-2.5 text-sm font-semibold text-slate-800 first:mt-0 dark:text-slate-100",
};

export function ChatMarkdown({ content }: { content: string }) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  if (!content.trim()) return null;

  return (
    <div className="break-words text-sm leading-relaxed">
      {blocks.map((block, idx) => {
        if (block.type === "h") {
          const Tag = (`h${block.level}` as "h1" | "h2" | "h3");
          return (
            <Tag key={idx} className={HEADING_CLASS[block.level]}>
              {renderInline(block.text, `h-${idx}`)}
            </Tag>
          );
        }

        if (block.type === "ul") {
          return (
            <ul
              key={idx}
              className="my-2 list-disc space-y-1.5 pl-5 text-slate-700 marker:text-slate-400 dark:text-slate-200"
            >
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item, `ul-${idx}-${j}`)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "ol") {
          return (
            <ol
              key={idx}
              className="my-2 list-decimal space-y-1.5 pl-5 text-slate-700 marker:text-slate-400 dark:text-slate-200"
            >
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item, `ol-${idx}-${j}`)}</li>
              ))}
            </ol>
          );
        }

        return (
          <p key={idx} className="mb-2 last:mb-0 text-slate-700 dark:text-slate-200">
            {renderInline(block.text, `p-${idx}`)}
          </p>
        );
      })}
    </div>
  );
}
