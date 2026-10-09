import Quill, { Delta } from "quill";
import { languageForFence } from "./syntax";

/**
 * Markdown pasted as text, arriving as the document it describes.
 *
 * A README copied out of a terminal or a plain-text editor reaches the
 * clipboard as `text/plain` alone, and Quill pastes it verbatim — every `#` and
 * `**` left standing. When the text is clearly Markdown it is converted here
 * instead, into the same headings, lists, tasks, code blocks and marks the
 * shortcuts make by hand.
 *
 * Deliberately narrow about when it fires. A paste that already carries
 * structured HTML is left to Quill, which reads that better than this reads
 * Markdown; so is anything pasted into a code block, where the backticks and
 * stars are the content.
 */

type Attributes = Record<string, unknown>;

/** Lines that only Markdown starts with. One is enough to call it Markdown. */
const BLOCK_MARKERS = /^(?:#{1,6}\s|\s*[-*+]\s+\[[ xX]\]\s|\s*[-*+]\s|\s*\d+[.)]\s|>\s?|```|(?:-{3,}|\*{3,})\s*$)/m;
/** Marks that are unambiguous inline: `**x**`, `` `x` ``, `[x](http…)`, `~~x~~`. */
const INLINE_MARKERS = /\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:|mailto:|\/)[^)\s]*\)|~~[^~\n]+~~/;

export function looksLikeMarkdown(text: string): boolean {
  return BLOCK_MARKERS.test(text) || INLINE_MARKERS.test(text);
}

/*
 * One pass over the inline marks, earliest match first. Each alternative's
 * groups are read by position below, so the order here is the order there.
 */
const INLINE = new RegExp(
  [
    /\\([\\`*_{}[\]()#+\-.!~>|])/.source, // 1: an escaped character, kept literally
    /(`+)([^`]|[^`][\s\S]*?[^`])\2(?!`)/.source, // 2,3: code
    /\*\*(?=\S)([\s\S]*?\S)\*\*/.source, // 4: bold
    /(?<![\w])__(?=\S)([\s\S]*?\S)__(?![\w])/.source, // 5: bold
    /~~(?=\S)([\s\S]*?\S)~~/.source, // 6: strike
    /\*(?=[^\s*])([\s\S]*?[^\s*])\*/.source, // 7: italic
    /(?<![\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\w])/.source, // 8: italic
    /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.source, // 9,10: link (or picture, as a link)
  ].join("|"),
);

const SAFE_LINK = /^(?:https?:\/\/|mailto:|\/)/i;

function inline(text: string, attributes: Attributes, delta: Delta): void {
  let rest = text;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) {
      delta.insert(rest, attributes);
      return;
    }
    if (match.index > 0) delta.insert(rest.slice(0, match.index), attributes);
    const [whole, escaped, , code, bold1, bold2, strike, italic1, italic2, label, url] = match;
    if (escaped !== undefined) delta.insert(escaped, attributes);
    else if (code !== undefined) delta.insert(code, { ...attributes, code: true });
    else if (bold1 ?? bold2) inline((bold1 ?? bold2)!, { ...attributes, bold: true }, delta);
    else if (strike !== undefined) inline(strike, { ...attributes, strike: true }, delta);
    else if (italic1 ?? italic2) inline((italic1 ?? italic2)!, { ...attributes, italic: true }, delta);
    else if (url !== undefined) {
      const words = label || url;
      if (SAFE_LINK.test(url)) inline(words, { ...attributes, link: url }, delta);
      else inline(words, attributes, delta);
    }
    else delta.insert(whole, attributes);
    rest = rest.slice(match.index + whole.length);
  }
}

/** Two spaces (or a tab) of leading whitespace per level of list nesting. */
function indentOf(spaces: string): Attributes {
  const level = Math.min(8, Math.floor(spaces.replace(/\t/g, "  ").length / 2));
  return level > 0 ? { indent: level } : {};
}

export function markdownToDelta(markdown: string): Delta {
  const delta = new Delta();
  // Trailing blank lines are not content.
  const lines = markdown.replace(/\r\n?/g, "\n").replace(/\s+$/, "").split("\n");
  let blank = false;

  const line = (text: string, block: Attributes) => {
    inline(text, {}, delta);
    delta.insert("\n", Object.keys(block).length > 0 ? block : undefined);
    blank = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";

    const fence = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/.exec(raw);
    if (fence) {
      const marker = fence[1]!;
      const language = languageForFence(fence[2] ?? "");
      const close = new RegExp(`^\\s*${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
      i += 1;
      for (; i < lines.length && !close.test(lines[i] ?? ""); i++) {
        delta.insert(lines[i] ?? "").insert("\n", { "code-block": language });
      }
      blank = false;
      continue;
    }

    if (!raw.trim()) {
      // Paragraphs in Markdown are separated by a blank line; in the editor
      // that is an empty line. Several in a row are still only one.
      if (!blank && delta.length() > 0) delta.insert("\n");
      blank = true;
      continue;
    }

    let m: RegExpExecArray | null;
    if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw))) line(m[2] ?? "", { header: m[1]!.length });
    else if (/^\s{0,3}(?:-\s*){3,}$|^\s{0,3}(?:\*\s*){3,}$|^\s{0,3}(?:_\s*){3,}$/.test(raw)) {
      delta.insert({ divider: true });
      blank = false;
    }
    else if ((m = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(raw))) {
      line(m[3] ?? "", { list: m[2] === " " ? "unchecked" : "checked", ...indentOf(m[1] ?? "") });
    }
    else if ((m = /^(\s*)[-*+]\s+(.*)$/.exec(raw))) line(m[2] ?? "", { list: "bullet", ...indentOf(m[1] ?? "") });
    else if ((m = /^(\s*)\d+[.)]\s+(.*)$/.exec(raw))) line(m[2] ?? "", { list: "ordered", ...indentOf(m[1] ?? "") });
    else if ((m = /^\s{0,3}>\s?(.*)$/.exec(raw))) line(m[1] ?? "", { blockquote: true });
    else line(raw.trim(), {});
  }

  // A last plain line keeps no newline of its own, so "some **bold**" pasted
  // mid-sentence stays in that sentence instead of splitting the paragraph.
  const last = delta.ops.at(-1);
  if (last && !last.attributes && typeof last.insert === "string" && last.insert.endsWith("\n")) {
    const trimmed = last.insert.slice(0, -1);
    if (trimmed) last.insert = trimmed;
    else delta.ops.pop();
  }
  return delta;
}

/**
 * Catches a paste before Quill does, when it is Markdown. Registered in the
 * capture phase on the editor root, which runs ahead of Quill's own handler.
 */
export function pasteMarkdown(quill: Quill): () => void {
  const onPaste = (event: ClipboardEvent) => {
    if (!quill.isEnabled() || event.defaultPrevented) return;
    const data = event.clipboardData;
    if (!data || data.files.length > 0) return;
    const text = data.getData("text/plain");
    const html = data.getData("text/html");
    // Rich HTML has its own structure; trust it over our reading of the text.
    if (!text || (html && /<(?:h[1-6]|ul|ol|li|table|pre|blockquote|strong|b|em)\b/i.test(html))) return;
    if (!looksLikeMarkdown(text)) return;

    const range = quill.getSelection(true);
    if (quill.getFormat(range)["code-block"]) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const pasted = markdownToDelta(text);
    quill.updateContents(
      new Delta().retain(range.index).delete(range.length).concat(pasted),
      Quill.sources.USER,
    );
    quill.setSelection(range.index + pasted.length(), Quill.sources.SILENT);
    quill.scrollSelectionIntoView();
  };
  quill.root.addEventListener("paste", onPaste, true);
  return () => quill.root.removeEventListener("paste", onPaste, true);
}
