import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { calendarItems } from "@/lib/calendar";
import { buildIcs } from "@/lib/ics";
import { addDays, todayUTC } from "@/lib/utils";

// Private subscription feed: /api/calendar/feed?token=CALENDAR_FEED_TOKEN
// Anyone with the full link can read the calendar, so treat it like a password. Change the token to revoke.
export async function GET(req: Request) {
  const expected = process.env.CALENDAR_FEED_TOKEN ?? "";
  const given = new URL(req.url).searchParams.get("token") ?? "";
  const ok = expected.length >= 24 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return new NextResponse("Not found", { status: 404 });

  const today = todayUTC();
  const items = await calendarItems(addDays(today, -60), addDays(today, 365));
  const body = buildIcs(items, { name: "VCG Property Manager", appUrl: process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin });
  return new NextResponse(body, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=900", "Content-Disposition": 'inline; filename="vcg.ics"' },
  });
}
