import type { DeltaOp } from "../shared/events.js";

/**
 * Turning a document into something you can take away: HTML or Markdown.
 *
 * Both come out of one pass, because the hard part is the same for both and
 * doing it twice is doing it wrong twice.
 *
 * The hard part is that a Quill delta does not describe lines. It is a flat
 * run of inserts, and a line's *block* formatting — heading, list, quote,
 * alignment — is carried by the attributes of the newline character that ends
 * it, not by the text before it. So `[{insert: "Title"}, {insert: "\n",
 * attributes: {header: 1}}]` is one h1, and the attribute arrives after the
 * content it applies to. Reading it any other way produces output that looks
 * right on simple documents and quietly loses formatting on real ones.
 */

export interface Segment {
  /** the text, or the embed if this is a picture */
  text?: string;
  image?: string;
  attributes: Record<string, unknown>;
}

export interface Line {
  segments: Segment[];
  /** heading, list, blockquote, code-block, align, indent */
  block: Record<string, unknown>;
}

/** Split a delta into lines, moving each newline's attributes onto its line. */
export function toLines(ops: DeltaOp[]): Line[] {
  const lines: Line[] = [];
  let current: Segment[] = [];

  const close = (block: Record<string, unknown>) => {
    lines.push({ segments: current, block });
    current = [];
  };

  for (const op of ops) {
    const attributes = op.attributes ?? {};
    if (typeof op.insert !== "string") {
      const image = (op.insert as { image?: unknown } | undefined)?.image;
      if (typeof image === "string") current.push({ image, attributes });
      continue;
    }

    const parts = op.insert.split("\n");
    parts.forEach((part, index) => {
      if (part) current.push({ text: part, attributes });
      // every part but the last was followed by a newline in the source
      if (index < parts.length - 1) close(attributes);
    });
  }

  // Trailing content with no closing newline. Quill always ends a document
  // with one, but a delta that arrived from somewhere else might not.
  if (current.length > 0) close({});
  return lines;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Only addresses we would have written ourselves, or a plain http(s) link. */
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.startsWith("/uploads/")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  }
  catch {
    return null;
  }
}

function inlineHtml(segment: Segment): string {
  if (segment.image !== undefined) {
    const src = safeUrl(segment.image);
    return src ? `<img src="${escapeHtml(src)}">` : "";
  }

  let html = escapeHtml(segment.text ?? "");
  const a = segment.attributes;

  if (a.bold) html = `<strong>${html}</strong>`;
  if (a.italic) html = `<em>${html}</em>`;
  if (a.underline) html = `<u>${html}</u>`;
  if (a.strike) html = `<s>${html}</s>`;
  if (a.code) html = `<code>${html}</code>`;
  if (a.script === "sub") html = `<sub>${html}</sub>`;
  if (a.script === "super") html = `<sup>${html}</sup>`;

  const styles: string[] = [];
  if (typeof a.color === "string") styles.push(`color:${cssValue(a.color)}`);
  if (typeof a.background === "string") styles.push(`background-color:${cssValue(a.background)}`);
  if (typeof a.font === "string") styles.push(`font-family:${cssValue(a.font)}`);
  if (styles.length > 0) html = `<span style="${escapeHtml(styles.join(";"))}">${html}</span>`;

  const href = safeUrl(a.link);
  if (href) html = `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${html}</a>`;
  return html;
}

/**
 * Colours and font names come out of a document other people can edit, and
 * they land inside a `style` attribute. Anything that is not a plain CSS
 * identifier or colour is dropped rather than escaped: `url(...)` and
 * `expression(...)` have no business here, and there is no legitimate value
 * this rejects.
 */
function cssValue(value: string): string {
  return /^[#a-zA-Z0-9(),.%\s-]+$/.test(value) ? value.trim() : "inherit";
}

function blockTag(block: Record<string, unknown>): string {
  const header = Number(block.header);
  if (Number.isInteger(header) && header >= 1 && header <= 6) return `h${header}`;
  if (block.blockquote) return "blockquote";
  if (block["code-block"]) return "pre";
  if (block.list) return "li";
  return "p";
}

export function toHtml(ops: DeltaOp[]): string {
  const out: string[] = [];
  /** open list tags, outermost first — one entry per indent level */
  let open: string[] = [];

  const closeLists = (downTo: number) => {
    while (open.length > downTo) out.push(`</${open.pop()}>`);
  };

  for (const line of toLines(ops)) {
    const tag = blockTag(line.block);
    const content = line.segments.map(inlineHtml).join("");

    if (tag === "li") {
      const wanted = line.block.list === "ordered" ? "ol" : "ul";
      const depth = Math.max(0, Number(line.block.indent) || 0);
      // A shallower line closes the deeper lists; a change of kind at the same
      // depth closes and reopens, so an ordered list never swallows a bulleted
      // one that happens to sit at the same indent.
      closeLists(depth + 1);
      if (open.length === depth + 1 && open[depth] !== wanted) closeLists(depth);
      while (open.length < depth + 1) {
        out.push(`<${wanted}>`);
        open.push(wanted);
      }
      out.push(`<li>${content}</li>`);
      continue;
    }

    closeLists(0);
    const align = typeof line.block.align === "string" ? cssValue(line.block.align) : null;
    const style = align ? ` style="text-align:${escapeHtml(align)}"` : "";
    out.push(tag === "pre" ? `<pre>${content}</pre>` : `<${tag}${style}>${content}</${tag}>`);
  }

  closeLists(0);
  open = [];
  return out.join("\n");
}

/** Wrap the body so the file opens as a document rather than a fragment. */
export function toHtmlDocument(title: string, ops: DeltaOp[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body { margin: 0 auto; max-width: 40rem; padding: 2rem 1rem; font: 16px/1.6 Georgia, serif; }
img { max-width: 100%; }
pre { background: #f0f0f0; border-radius: 3px; padding: 0.75rem; overflow-x: auto; }
blockquote { border-left: 4px solid #ccc; margin-left: 0; padding-left: 1rem; }
</style>
</head>
<body>
${toHtml(ops)}
</body>
</html>
`;
}

/**
 * Markdown escaping, kept deliberately narrow.
 *
 * Only the characters that would start a construct where they sit: a leading
 * `#` or `-` turns a line into a heading or a bullet, and `*`, `_`, `[` and
 * backticks change meaning anywhere. Escaping more than that produces files
 * full of backslashes, which is its own kind of wrong output.
 */
function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]])/g, "\\$1").replace(/^(\s*)([#>-])/, "$1\\$2");
}

function inlineMarkdown(segment: Segment): string {
  if (segment.image !== undefined) {
    const src = safeUrl(segment.image);
    return src ? `![](${src})` : "";
  }

  const a = segment.attributes;
  let text = escapeMarkdown(segment.text ?? "");
  if (!text) return "";

  if (a.code) text = `\`${segment.text}\``;
  if (a.bold) text = `**${text}**`;
  if (a.italic) text = `_${text}_`;
  if (a.strike) text = `~~${text}~~`;

  const href = safeUrl(a.link);
  return href ? `[${text}](${href})` : text;
}

export function toMarkdown(ops: DeltaOp[]): string {
  const out: string[] = [];
  let inCodeBlock = false;

  const endCode = () => {
    if (inCodeBlock) {
      out.push("```");
      inCodeBlock = false;
    }
  };

  for (const line of toLines(ops)) {
    const block = line.block;
    // Inside a fence the text is code, so none of the inline marks apply.
    const raw = line.segments.map((s) => s.text ?? "").join("");
    const content = line.segments.map(inlineMarkdown).join("");

    if (block["code-block"]) {
      if (!inCodeBlock) {
        out.push("```");
        inCodeBlock = true;
      }
      out.push(raw);
      continue;
    }
    endCode();

    const header = Number(block.header);
    const indent = "  ".repeat(Math.max(0, Number(block.indent) || 0));

    if (Number.isInteger(header) && header >= 1 && header <= 6) out.push(`${"#".repeat(header)} ${content}`);
    else if (block.blockquote) out.push(`> ${content}`);
    else if (block.list === "ordered") out.push(`${indent}1. ${content}`);
    else if (block.list) out.push(`${indent}- ${content}`);
    else out.push(content);
  }

  endCode();
  // Markdown needs a blank line between blocks, but not inside a list or a
  // fence, where one would break the construct.
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
