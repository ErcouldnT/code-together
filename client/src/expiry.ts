import { useEffect, useState } from "react";
import { EXPIRY_CHOICES, type SetExpiryRequest } from "@shared/access";
import { language, t } from "./i18n";
import { forgetDocument } from "./recent";
import type { SocketProvider } from "./yjs/socketProvider";

/**
 * The browser's side of documents that delete themselves: what to call each
 * choice, asking the server to change it, keeping the countdown live, and
 * clearing up once the document has gone.
 */

export const EXPIRY_LABELS: Record<(typeof EXPIRY_CHOICES)[number], string> = {
  [EXPIRY_CHOICES[0]]: t("expiry.1h"),
  [EXPIRY_CHOICES[1]]: t("expiry.24h"),
  [EXPIRY_CHOICES[2]]: t("expiry.7d"),
  [EXPIRY_CHOICES[3]]: t("expiry.30d"),
};

export async function setExpiry(documentId: string, expiresIn: number | null): Promise<number | null> {
  const response = await fetch(`/api/documents/${documentId}/expiry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expiresIn } satisfies SetExpiryRequest),
  });
  if (!response.ok) throw new Error(`expiry ${response.status}`);
  return ((await response.json()) as { expiresAt: number | null }).expiresAt;
}

/**
 * The document's expiry as it stands: what the access check said when the
 * page opened, then whatever the room is told after that — someone else in it
 * may set or clear it while this tab is open.
 */
export function useExpiry(provider: SocketProvider | null, initial: number | null): [number | null, (value: number | null) => void] {
  const [expiresAt, setExpiresAt] = useState(initial);
  useEffect(() => {
    const socket = provider?.socket;
    if (!socket) return;
    socket.on("expiry-changed", setExpiresAt);
    return () => {
      socket.off("expiry-changed", setExpiresAt);
    };
  }, [provider]);
  return [expiresAt, setExpiresAt];
}

/** The clock, ticking once a minute — often enough for "in 3 hours". */
export function useNow(every = 60_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(timer);
  }, [every]);
  return now;
}

const UNITS = [
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
] as const;

/**
 * "23 hours", "6 days", "1 minute" — the largest unit that fits, rounded up so
 * the last minute still says one minute rather than none. Intl does the words
 * and, in Russian, the three plural forms.
 */
export function timeLeft(ms: number): string {
  const left = Math.max(ms, 60_000);
  const { unit, ms: size } = UNITS.find((entry) => left >= entry.ms) ?? UNITS[2];
  const count = Math.ceil(left / size - 0.01);
  return new Intl.NumberFormat(language, { style: "unit", unit, unitDisplay: "long" }).format(count);
}

/**
 * Forget a document that no longer exists: the copy this browser kept of it,
 * and its place in the recent list. The copy matters most — left behind, it
 * would be offered back to the server the next time the address is opened.
 */
export function forgetExpired(documentId: string): void {
  forgetDocument(documentId);
  try {
    indexedDB.deleteDatabase(`code-together:${documentId}`);
  }
  catch {
    // no IndexedDB here, so nothing was kept
  }
}
