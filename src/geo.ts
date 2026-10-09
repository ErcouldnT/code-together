import type { IncomingHttpHeaders } from "node:http";
import { isIP } from "node:net";
import geoip from "geoip-country";

/**
 * Who is on the other end of a request — the address, and the country it
 * belongs to — for the admin screen's record of where documents are made
 * and changed from.
 *
 * Behind Coolify's Traefik the socket's own address is the proxy's, and the
 * visitor is the last entry Traefik appended to X-Forwarded-For. Only the last
 * one: anything before it was written by the visitor and is whatever they
 * liked. This is the same single hop `trust proxy` is set to for Express.
 *
 * The country comes from Cloudflare's CF-IPCountry when there is a Cloudflare
 * in front, which knows better, and otherwise from the GeoLite2 table that
 * ships with geoip-country — on disk, no request leaves the server.
 */

export interface Origin {
  ip: string;
  country: string | null;
}

function normalise(address: string): string {
  const trimmed = address.trim();
  // an IPv4 visitor reaching an IPv6 socket
  return trimmed.startsWith("::ffff:") && isIP(trimmed.slice(7)) === 4 ? trimmed.slice(7) : trimmed;
}

export function countryOf(ip: string, headers?: IncomingHttpHeaders): string | null {
  const cf = headers?.["cf-ipcountry"];
  // XX is Cloudflare for "no country", T1 for Tor
  if (typeof cf === "string" && /^[A-Z]{2}$/.test(cf) && cf !== "XX" && cf !== "T1") return cf;
  if (!isIP(ip)) return null;
  return geoip.lookup(ip)?.country ?? null;
}

export function originOf(headers: IncomingHttpHeaders, remoteAddress: string | undefined, trustProxy = true): Origin {
  let ip = remoteAddress ?? "";
  const forwarded = headers["x-forwarded-for"];
  if (trustProxy && forwarded) {
    const last = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded).split(",").pop();
    if (last && isIP(last.trim())) ip = last;
  }
  ip = normalise(ip) || "unknown";
  return { ip, country: countryOf(ip, headers) };
}
