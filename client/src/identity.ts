/**
 * Who you are in a room.
 *
 * There are no accounts here — a room is a URL, and anyone with it can edit.
 * So identity is local: a name and a colour kept in this browser, made up on
 * the first visit and changeable at any time. It exists so the cursor moving
 * around the page belongs to somebody rather than to "User: 2847391043".
 */

const STORAGE_KEY = "code-together:identity";

/**
 * Cursor colours.
 *
 * These cannot come from the theme tokens the way the rest of the styling
 * does: their whole job is to tell two people apart, so they have to stay the
 * same colour in both themes. Each was measured for at least 3:1 contrast
 * against both the light sheet (#ffffff) and the dark one (#1e2126), and the
 * seven are spread across the hue circle so no two read as the same person.
 */
const COLORS = [
  "#e2445c", // red
  "#c77800", // amber
  "#1f9d55", // green
  "#2a9d8f", // teal
  "#4895ef", // blue
  "#8b5cf6", // violet
  "#d6336c", // pink
];

const ADJECTIVES = [
  "Quiet", "Swift", "Bright", "Calm", "Bold", "Clever", "Gentle", "Keen",
  "Lucky", "Merry", "Patient", "Curious",
];

const CREATURES = [
  "Otter", "Falcon", "Badger", "Heron", "Lynx", "Magpie", "Marten", "Puffin",
  "Raven", "Seal", "Stoat", "Wren",
];

export interface Identity {
  name: string;
  color: string;
}

function pick<T>(values: readonly T[]): T {
  // values is never empty; the non-null assertion is the price of
  // noUncheckedIndexedAccess, which is worth keeping on everywhere else.
  return values[Math.floor(Math.random() * values.length)]!;
}

function generate(): Identity {
  return { name: `${pick(ADJECTIVES)} ${pick(CREATURES)}`, color: pick(COLORS) };
}

/** Reject anything that would make a nonsense of somebody else's presence bar. */
function clean(value: unknown): Identity | null {
  if (typeof value !== "object" || value === null) return null;
  const { name, color } = value as { name?: unknown; color?: unknown };
  if (typeof name !== "string" || typeof color !== "string") return null;
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  return { name: trimmed, color };
}

export function loadIdentity(): Identity {
  try {
    const stored = clean(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
    if (stored) return stored;
  }
  catch {
    // corrupt or unavailable storage — a new identity is a fine answer
  }
  const fresh = generate();
  saveIdentity(fresh);
  return fresh;
}

export function saveIdentity(identity: Identity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  }
  catch {
    // private mode, or a full quota. The name still works for this session.
  }
}

/** The first letter or two, for a presence chip too small to hold a name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.map((word) => [...word][0] ?? "").join("").toUpperCase() || "?";
}
