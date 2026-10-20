import type { CalItem } from "./calendar";

// Minimal RFC 5545 calendar for subscribing from Google Calendar, Apple Calendar, or Outlook.

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets are folded with CRLF + space (counting bytes, not characters). */
function fold(line: string) {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

export function buildIcs(items: CalItem[], opts: { name: string; appUrl: string; now?: Date }) {
  const now = stamp(opts.now ?? new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Venture Collective Group//Property Manager//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(opts.name)}`,
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const it of items) {
    lines.push("BEGIN:VEVENT", `UID:${it.key}@vcg-property-manager`, `DTSTAMP:${now}`);
    if (it.allDay || !it.start) {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(it.day)}`, `DTEND;VALUE=DATE:${dateOnly(new Date(it.day.getTime() + 86_400_000))}`);
    } else {
      const end = it.end && it.end > it.start ? it.end : new Date(it.start.getTime() + 3_600_000);
      lines.push(`DTSTART:${stamp(it.start)}`, `DTEND:${stamp(end)}`);
    }
    lines.push(`SUMMARY:${esc(it.title)}`);
    if (it.detail) lines.push(`DESCRIPTION:${esc(it.detail)}`);
    if (it.location) lines.push(`LOCATION:${esc(it.location)}`);
    lines.push(`URL:${opts.appUrl.replace(/\/$/, "")}${it.href}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
