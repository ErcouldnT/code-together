import Quill from "quill";

/**
 * A horizontal rule: what `---` means in Markdown, and the one block Quill
 * does not ship. An embed rather than a format, because it has no text — in
 * the delta it is `{ insert: { divider: true } }`, which the exports on the
 * server know to turn back into `<hr>` and `---`.
 */
const BlockEmbed = Quill.import("blots/block/embed") as typeof import("parchment").EmbedBlot;

class Divider extends BlockEmbed {
  static override blotName = "divider";
  static override tagName = "HR";
}

Quill.register(Divider, true);
