import Quill, { Delta } from "quill";

/**
 * Markdown typed into a rich-text editor, turned into the formatting it means
 * the moment it is unambiguous.
 *
 * `# ` at the start of a line is a heading, `> ` a quote, and three backticks
 * followed by Enter a code block. Quill already does `- `, `* `, `1. ` and
 * `[ ] ` for lists by itself ("list autofill"); these sit beside it and work
 * the same way, so one undo after any of them gives back exactly what was
 * typed — the marker, as text.
 *
 * Everything here goes through `updateContents` as a user edit, which is what
 * y-quill turns into a Yjs update. Nothing is special about a shortcut once it
 * has fired: the others in the room just see a heading appear.
 */

/** The shape of a Quill keyboard binding, as far as these use it. */
interface Binding {
  key: string;
  collapsed?: boolean;
  shiftKey?: boolean | null;
  format?: Record<string, boolean>;
  prefix?: RegExp;
  suffix?: RegExp;
  /** `this` is the keyboard module; returning true lets the key through */
  handler: (this: { quill: Quill }, range: { index: number; length: number }, context: { prefix: string }) => boolean;
}

/** Shortcuts never fire inside code, where `# ` is a comment and `>` is an operator. */
const NOT_IN_CODE = { "code-block": false };

/**
 * Swap the marker at the start of the current line for a block format.
 *
 * The space (or newline) that triggered it is written first and the history
 * cut after it, as Quill's own list autofill does: undo then lands on "# "
 * rather than on "#", which is what someone who did not want a heading meant.
 */
function replaceMarker(
  quill: Quill,
  range: { index: number },
  marker: string,
  format: Record<string, unknown>,
  typed: string | null,
): boolean {
  const [line, offset] = quill.getLine(range.index);
  // `prefix` is measured from the start of the text leaf, not of the line; a
  // marker that only looks like it starts the line (after a bold word, say)
  // is not one.
  if (!line || offset !== marker.length) return true;

  const start = range.index - offset;
  // Read before anything is inserted: `line` is the live blot, and it grows.
  const rest = line.length() - 1 - offset;
  if (typed !== null) {
    quill.insertText(range.index, typed, Quill.sources.USER);
    quill.history.cutoff();
  }
  const removed = marker.length + (typed?.length ?? 0);
  const change = new Delta().retain(start).delete(removed).retain(rest).retain(1, format);
  quill.updateContents(change, Quill.sources.USER);
  quill.history.cutoff();
  quill.setSelection(start, Quill.sources.SILENT);
  return false;
}

/**
 * What a fence's info string becomes. Until the language picker exists every
 * code block is just a code block; the hook is here so the fence does not have
 * to be parsed twice.
 */
export type FenceLanguage = (info: string) => string | true;

let fenceLanguage: FenceLanguage = () => true;

export function setFenceLanguage(resolve: FenceLanguage): void {
  fenceLanguage = resolve;
}

export const markdownBindings: Record<string, Binding> = {
  "markdown header": {
    key: " ",
    shiftKey: null,
    collapsed: true,
    format: NOT_IN_CODE,
    prefix: /^#{1,6}$/,
    handler(range, context) {
      return replaceMarker(this.quill, range, context.prefix, { header: context.prefix.length }, " ");
    },
  },
  "markdown quote": {
    key: " ",
    shiftKey: null,
    collapsed: true,
    format: { ...NOT_IN_CODE, blockquote: false },
    prefix: /^>$/,
    handler(range, context) {
      return replaceMarker(this.quill, range, context.prefix, { blockquote: true }, " ");
    },
  },
  /*
   * A fence opens on Enter, as it does in every Markdown editor: the line
   * ```js becomes an empty JavaScript code block with the caret in it. Space
   * does it too, for people who type the fence and keep going.
   */
  "markdown fence": {
    key: "Enter",
    shiftKey: null,
    collapsed: true,
    format: NOT_IN_CODE,
    prefix: /^```[\w+#.-]*$/,
    suffix: /^\s*$/,
    handler(range, context) {
      const info = context.prefix.slice(3);
      return replaceMarker(this.quill, range, context.prefix, { "code-block": fenceLanguage(info) }, null);
    },
  },
  "markdown fence space": {
    key: " ",
    shiftKey: null,
    collapsed: true,
    format: NOT_IN_CODE,
    prefix: /^```[\w+#.-]*$/,
    suffix: /^\s*$/,
    handler(range, context) {
      const info = context.prefix.slice(3);
      return replaceMarker(this.quill, range, context.prefix, { "code-block": fenceLanguage(info) }, null);
    },
  },
};
