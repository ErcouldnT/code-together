import { format, formatDistanceToNowStrict, type Locale } from "date-fns";
import { enUS, ru, tr } from "date-fns/locale";
import { language, type Language } from "../i18n";

/**
 * Dates and places as the admin screen says them: "3 days ago", a stamp to
 * the minute, and a country as its flag and name in the page's language.
 */

const LOCALES: Record<Language, Locale> = { en: enUS, tr, ru };
const locale = LOCALES[language];

/** "3 days ago", "5 minutes ago" — whole units, no "about". */
export function ago(ms: number): string {
  return formatDistanceToNowStrict(ms, { addSuffix: true, locale });
}

/** "9 Oct 2026 14:11" */
export function stamp(ms: number): string {
  return format(ms, "d MMM yyyy HH:mm", { locale });
}

/** "9 Oct" — for the axis of a chart */
export function shortDay(day: string): string {
  return format(new Date(`${day}T00:00:00`), "d MMM", { locale });
}

const regions = new Intl.DisplayNames([language], { type: "region" });

/** 🇹🇷 from TR: each letter's regional-indicator symbol. */
export function flag(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function countryName(code: string): string {
  try {
    return regions.of(code.toUpperCase()) ?? code;
  }
  catch {
    return code;
  }
}
