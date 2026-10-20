import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runAllWorkflows } from "@/lib/workflows";
import { aiConfigured, runDailyReview } from "@/lib/ai/assistant";
import { adminEmails } from "@/lib/admins";

export const maxDuration = 300;

/**
 * Scheduled runner. Vercel Cron calls this with "Authorization: Bearer <CRON_SECRET>" (see vercel.json).
 * Any other scheduler (cron-job.org, GitHub Actions) can call it the same way.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secret.length < 16 || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const results = await runAllWorkflows({ source: "schedule", statusCallback: base?.startsWith("https://") ? `${base}/api/twilio/status` : undefined });

  // Optional: the AI daily review, once per ~day
  let review: string | null = null;
  if (process.env.AI_DAILY_REVIEW === "true" && aiConfigured()) {
    const recent = await db.aiConversation.findFirst({ where: { title: { startsWith: "Daily review" }, createdAt: { gt: new Date(Date.now() - 20 * 3600_000) } } });
    if (!recent) {
      try {
        review = (await runDailyReview(adminEmails()[0] ?? "scheduler")).conversationId;
      } catch (e) {
        review = `failed: ${e instanceof Error ? e.message : e}`;
      }
    }
  }
  return NextResponse.json({ ranAt: new Date().toISOString(), workflows: results.map(({ preview: _p, ...r }) => r), dailyReview: review });
}
