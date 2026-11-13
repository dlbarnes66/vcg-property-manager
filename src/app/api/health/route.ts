import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const SETTINGS = [
  "DATABASE_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "ALLOWED_EMAILS", "NEXT_PUBLIC_APP_URL",
  "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "CRON_SECRET", "CALENDAR_FEED_TOKEN", "ANTHROPIC_API_KEY",
] as const;

/** Removes anything that could be a secret (connection strings, hosts, keys) from an error message. */
const scrub = (s: string) =>
  s.replace(/postgres(ql)?:\/\/\S+/gi, "postgresql://***").replace(/[a-z0-9-]+\.(neon\.tech|supabase\.co|amazonaws\.com)\S*/gi, "***host***").replace(/[A-Za-z0-9_\-]{32,}/g, "***").slice(0, 400);

/**
 * GET /api/health — is the app able to reach its database, and which settings are present?
 * Shows only yes/no for settings (never values), so it is safe to leave public.
 */
export async function GET() {
  const settings = Object.fromEntries(SETTINGS.map((k) => [k, Boolean(process.env[k]?.trim())]));
  const url = process.env.DATABASE_URL ?? "";
  const dbUrl = {
    startsWithPostgres: /^postgres(ql)?:\/\//.test(url.trim()),
    hasQuotesOrSpaces: /^["'\s]|["'\s]$/.test(url),
    hasSslMode: /sslmode=require/.test(url),
    hasChannelBinding: /channel_binding=/.test(url),
    looksPooled: /-pooler\./.test(url),
    passwordMasked: /:\*+@/.test(url),
  };
  let database: Record<string, unknown>;
  try {
    await db.$queryRawUnsafe("select 1");
    const migrations = await db.$queryRawUnsafe<{ n: bigint }[]>(`select count(*)::bigint as n from "_prisma_migrations" where finished_at is not null`);
    const tables = await db.$queryRawUnsafe<{ n: bigint }[]>(`select count(*)::bigint as n from information_schema.tables where table_schema = 'public'`);
    database = { ok: true, migrationsApplied: Number(migrations[0]?.n ?? 0), tables: Number(tables[0]?.n ?? 0) };
  } catch (e) {
    const err = e as { name?: string; code?: string; errorCode?: string; message?: string };
    database = { ok: false, error: err.name, code: err.code ?? err.errorCode ?? null, message: scrub(err.message ?? String(e)) };
  }
  return NextResponse.json({ database, dbUrl, settings, node: process.version, region: process.env.VERCEL_REGION ?? null }, { headers: { "Cache-Control": "no-store" } });
}
