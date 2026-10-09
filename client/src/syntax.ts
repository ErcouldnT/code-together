import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import Quill, { Delta } from "quill";
import Syntax from "quill/modules/syntax";
import type { QuillBinding } from "y-quill";
import { t } from "./i18n";
import { setFenceLanguage } from "./markdown";

/**
 * Code blocks that colour themselves, guess their own language, and let you
 * correct the guess.
 *
 * Built on Quill's own syntax module, with two changes that matter.
 *
 * First, a block nobody has chosen a language for is not "plain", it is
 * *automatic*: highlight.js guesses from the text, and the picker says what it
 * guessed — "Auto · Python". Choosing a language from the picker writes it
 * into the document, so it holds for everyone in the room and survives the
 * code changing under it; choosing "Auto" again hands the decision back.
 *
 * Second, the colours stay on this screen. Quill highlights by *formatting*
 * the text, and y-quill faithfully sends every format to the room — so out of
 * the box each person's highlighter would write token marks into the shared
 * document, every peer would re-highlight what arrived and send that back, a
 * reader's tab would have every one of those writes refused, and every export
 * would carry them. `keepTokensLocal` strips them on their way to Yjs. What
 * travels is the code and the language someone chose; each browser paints its
 * own colours.
 */

const REGISTERED = {
  bash, c, cpp, csharp, css, diff, dockerfile, go, java, javascript, json, kotlin,
  markdown, php, python, ruby, rust, sql, swift, typescript, xml, yaml,
};
for (const [name, language] of Object.entries(REGISTERED)) hljs.registerLanguage(name, language);

/** Quill's name for "no language chosen", which this module reads as "guess". */
export const AUTO = "plain";
/** An explicit choice of no highlighting at all. */
export const TEXT = "text";

const LABELS: Record<keyof typeof REGISTERED, string> = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  dockerfile: "Dockerfile",
  go: "Go",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  markdown: "Markdown",
  php: "PHP",
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  sql: "SQL",
  swift: "Swift",
  typescript: "TypeScript",
  xml: "HTML / XML",
  yaml: "YAML",
};

const LANGUAGES = [
  { key: AUTO, label: t("code.auto") },
  { key: TEXT, label: t("code.plain") },
  ...Object.entries(LABELS).map(([key, label]) => ({ key, label })),
];

const KEYS = Object.keys(REGISTERED);

/**
 * What a fence's info string names, in our terms: "js" and "JavaScript" are
 * both `javascript`, an empty or unknown one is left to the guesser.
 */
export function languageForFence(info: string): string | true {
  const name = info.trim().toLowerCase();
  if (!name) return true;
  if (name === TEXT || name === "txt" || name === "plaintext") return TEXT;
  if (name in REGISTERED) return name;
  for (const key of KEYS) {
    if (hljs.getLanguage(key)?.aliases?.includes(name)) return key;
  }
  return true;
}

setFenceLanguage(languageForFence);

/*
 * A guess is only worth showing when highlight.js is fairly sure. Two lines of
 * prose score a few points as Markdown or as Bash; below this they are text.
 */
const MIN_RELEVANCE = 4;

/** Guesses by exact text, so the label can find what the highlighter decided. */
const guesses = new Map<string, string | null>();

function guess(text: string): string | null {
  const known = guesses.get(text);
  if (known !== undefined) return known;
  const result = hljs.highlightAuto(text, KEYS);
  const language = result.language && result.relevance >= MIN_RELEVANCE ? result.language : null;
  guesses.set(text, language);
  // Every keystroke in a block is a new text; keep the most recent ones only.
  if (guesses.size > 200) guesses.delete(guesses.keys().next().value as string);
  return language;
}

/**
 * The newlines in a highlighted delta carry the block's language. Quill
 * diffs them against the block and writes back any difference — so they must
 * say exactly what the block already says, or the guess would be written into
 * the document as if someone had chosen it.
 */
function relabel(delta: Delta, language: string): Delta {
  return new Delta(
    delta.ops.map((op) =>
      op.attributes?.["code-block"] === undefined
        ? op
        : { ...op, attributes: { ...op.attributes, "code-block": language } }),
  );
}

/** The text of one block, joined the way Quill joins it, so the guesses line up. */
function blockText(container: Element): string {
  const lines = Array.from(container.childNodes).filter(
    (node) => !(node instanceof HTMLElement && node.classList.contains("ql-ui")),
  );
  return `${lines.map((node) => node.textContent).join("\n")}\n`;
}

class AutoSyntax extends Syntax {
  override highlightBlot(text: string, language = AUTO): Delta {
    let use = language;
    if (language === AUTO) use = guess(text) ?? TEXT;
    // Quill's "plain" path is the no-colour path; "text" is ours for the same.
    const delta = super.highlightBlot(text, use === TEXT ? AUTO : use);
    return relabel(delta, language);
  }

  override highlight(blot?: Parameters<Syntax["highlight"]>[0], force?: boolean): void {
    super.highlight(blot, force);
    this.refreshPickers();
  }

  /**
   * Say what "Auto" decided, and lock the pickers when the editor is locked:
   * a reader choosing a language would be an edit the server refuses.
   */
  refreshPickers(): void {
    const enabled = this.quill.isEnabled();
    for (const container of this.quill.root.querySelectorAll(".ql-code-block-container")) {
      const picker = container.querySelector<HTMLSelectElement>("select.ql-ui");
      if (!picker) continue;
      picker.disabled = !enabled;
      const auto = picker.querySelector<HTMLOptionElement>(`option[value="${AUTO}"]`);
      if (!auto) continue;
      const guessed = guesses.get(blockText(container));
      const label = guessed ? t("code.autoDetected", { language: LABELS[guessed as keyof typeof LABELS] ?? guessed }) : t("code.auto");
      if (auto.textContent !== label) auto.textContent = label;
    }
  }
}

Quill.register("modules/syntax", AutoSyntax, true);

export const syntaxOptions = { hljs, languages: LANGUAGES, interval: 400 };

/** For the editor, after it is enabled or disabled. */
export function refreshCodePickers(quill: Quill): void {
  (quill.getModule("syntax") as AutoSyntax | undefined)?.refreshPickers();
}

type Observer = (eventName: string, delta: unknown, state: unknown, origin: unknown) => void;

/** One op with the colour marks taken off. */
function withoutTokens(op: Record<string, unknown>): Record<string, unknown> {
  const attributes = op.attributes as Record<string, unknown> | undefined;
  if (!attributes || !("code-token" in attributes)) return op;
  const { "code-token": _token, ...rest } = attributes;
  const next: Record<string, unknown> = { ...op };
  if (Object.keys(rest).length > 0) next.attributes = rest;
  else delete next.attributes;
  // A retain that only coloured text is now a retain that does nothing.
  return next.retain !== undefined && next.attributes === undefined ? { retain: next.retain } : next;
}

/**
 * Put a filter between Quill and y-quill that drops the highlighter's marks.
 *
 * y-quill subscribes in its constructor and unsubscribes by the same property
 * in `destroy`, so swapping the property and the subscription together keeps
 * both of those working.
 */
export function keepTokensLocal(binding: QuillBinding, quill: Quill): void {
  const internals = binding as unknown as { _quillObserver: Observer };
  const original = internals._quillObserver;
  quill.off("editor-change", original);
  const filtered: Observer = (eventName, delta, state, origin) => {
    const ops = (delta as { ops?: Record<string, unknown>[] } | null)?.ops;
    if (eventName !== "text-change" || !ops) {
      original(eventName, delta, state, origin);
      return;
    }
    const kept = ops.map(withoutTokens);
    // Nothing but retains: a pure re-colouring. Passed on empty so y-quill
    // still updates the cursors, which it does on every event.
    const meaningful = kept.some((op) => op.retain === undefined || op.attributes !== undefined);
    original(eventName, new Delta(meaningful ? (kept as ConstructorParameters<typeof Delta>[0]) : []), state, origin);
  };
  internals._quillObserver = filtered;
  quill.on("editor-change", filtered);
}
