import type Quill from "quill";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n";

/**
 * The document's headings, as a list to jump around by.
 *
 * Read off the editor rather than the Yjs text: what matters is where each
 * heading sits on this screen, and Quill already knows which line is which
 * blot. Re-read shortly after any change — local or from somebody else in the
 * room — so typing a heading's words does not rebuild the list per keystroke.
 *
 * On a wide screen it is a column to the left of the page that stays open
 * while you work; on anything narrower it is a drawer over the page, and
 * choosing a heading puts it away again, because there is no room to read the
 * document beside it.
 */

export interface Heading {
  /** the line's blot, for scrolling to it */
  node: HTMLElement;
  level: number;
  text: string;
}

const REREAD_MS = 250;

function readHeadings(quill: Quill): Heading[] {
  const headings: Heading[] = [];
  for (const line of quill.getLines()) {
    const level = Number((line.formats() as { header?: unknown }).header);
    if (!Number.isInteger(level) || level < 1 || level > 6) continue;
    const node = line.domNode as HTMLElement;
    const text = node.textContent?.trim() ?? "";
    if (text) headings.push({ node, level, text });
  }
  return headings;
}

/** How far down the page the sticky top bar and toolbar reach. */
function coveredTop(): number {
  const toolbar = document.querySelector(".container .ql-toolbar");
  const bottom = toolbar?.getBoundingClientRect().bottom ?? 0;
  return Math.max(0, bottom) + 12;
}

export function useHeadings(quill: Quill | null): Heading[] {
  const [headings, setHeadings] = useState<Heading[]>([]);

  useEffect(() => {
    if (!quill) return;
    let timer: number | undefined;
    const reread = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setHeadings(readHeadings(quill)), REREAD_MS);
    };
    setHeadings(readHeadings(quill));
    quill.on("text-change", reread);
    return () => {
      window.clearTimeout(timer);
      quill.off("text-change", reread);
    };
  }, [quill]);

  return headings;
}

/** Which heading the reader is in: the last one scrolled past the top. */
function useCurrent(headings: Heading[]): number {
  const [current, setCurrent] = useState(-1);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = coveredTop() + 4;
      let index = -1;
      headings.forEach((heading, i) => {
        if (heading.node.getBoundingClientRect().top <= top) index = i;
      });
      // Above the first heading the first one is still the place you are at.
      setCurrent(headings.length > 0 ? Math.max(0, index) : -1);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [headings]);

  return current;
}

interface Props {
  headings: Heading[];
  /** true where the panel covers the page rather than sitting beside it */
  overlay: boolean;
  onClose: () => void;
}

export default function TableOfContents({ headings, overlay, onClose }: Props) {
  const current = useCurrent(headings);
  const list = useRef<HTMLElement>(null);

  // A drawer is a modal moment: Escape closes it, as it closes the menus.
  useEffect(() => {
    if (!overlay) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [overlay, onClose]);

  // Keep the highlighted entry in view in a long outline.
  useEffect(() => {
    list.current?.querySelector('[aria-current="location"]')?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const jump = useCallback((heading: Heading) => {
    const top = heading.node.getBoundingClientRect().top + window.scrollY - coveredTop();
    window.scrollTo({ top, behavior: "smooth" });
    if (overlay) onClose();
  }, [overlay, onClose]);

  // Indent relative to the biggest heading actually used, so a document that
  // starts at ## is not pushed in by a level it does not have.
  const top = Math.min(...headings.map((heading) => heading.level));

  return (
    <>
      {overlay && <div className="toc-backdrop" onClick={onClose} aria-hidden="true" />}
      <nav className="toc" data-overlay={overlay || undefined} aria-label={t("toc.title")} ref={list}>
        <div className="toc-head">
          <h2 className="toc-title">{t("toc.title")}</h2>
          <button type="button" className="toc-close" onClick={onClose} aria-label={t("toc.hide")} title={t("toc.hide")}>
            ×
          </button>
        </div>
        {headings.length === 0
          ? <p className="toc-empty">{t("toc.empty")}</p>
          : (
              <ol className="toc-list">
                {headings.map((heading, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      className="toc-item"
                      style={{ paddingInlineStart: `${0.6 + (heading.level - top) * 0.85}rem` }}
                      data-level={heading.level - top + 1}
                      aria-current={index === current ? "location" : undefined}
                      onClick={() => jump(heading)}
                    >
                      {heading.text}
                    </button>
                  </li>
                ))}
              </ol>
            )}
      </nav>
    </>
  );
}
