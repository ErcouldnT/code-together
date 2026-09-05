/**
 * What you look at before the document arrives.
 *
 * It is the sheet of paper the editor is about to become — same width, same
 * padding, same shadow, in the same place — with a few lines drawn on it.
 * Measured: the skeleton sheet and the real editor occupy an identical box, so
 * nothing moves when one replaces the other. A spinner on an empty page would
 * be followed by the whole layout arriving underneath it.
 *
 * Purely visual. What is happening is said once, by the notice bar, which is
 * where this app says everything else about the connection.
 */

/*
 * Line widths, in percent. Hand-picked rather than random: fresh random widths
 * on every render would make the skeleton twitch, and a paragraph whose lines
 * are all the same length does not read as text. The short line ending each
 * group is where a paragraph stops.
 */
const PARAGRAPHS = [
  [96, 88, 92, 45],
  [94, 90, 71],
  [89, 95, 84, 38],
];

interface Props {
  /** a hard failure is not a loading state; the notice bar explains it instead */
  problem: string | null;
}

export default function DocumentSkeleton({ problem }: Props) {
  if (problem) return null;

  return (
    // Scaffolding, not content — announcing twelve blank lines helps nobody.
    <div className="skeleton" aria-hidden="true">
      <div className="skeleton-sheet">
        <div className="skeleton-line skeleton-title" />
        {PARAGRAPHS.map((widths, paragraph) => (
          <div className="skeleton-paragraph" key={paragraph}>
            {widths.map((width, line) => (
              <div className="skeleton-line" key={line} style={{ width: `${width}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
