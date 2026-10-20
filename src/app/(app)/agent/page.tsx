import Link from "next/link";
import { db } from "@/lib/db";
import { aiConfigured } from "@/lib/ai/assistant";
import { toProposalView } from "@/lib/ai/load";
import { ActionForm } from "@/components/action-form";
import { ProposalCard } from "@/components/proposal-card";
import { Badge, Card, CardBody, CardHeader, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { fmtLocal } from "@/lib/dates";
import { startDailyReview } from "./actions";

export const metadata = { title: "Approvals" };

const source = (s: string) => (s === "assistant" ? "AI Assistant" : s === "daily-review" ? "Daily review" : s.startsWith("workflow:") ? `Workflow: ${s.slice(9)}` : s);

export default async function AgentPage() {
  const [pending, history] = await Promise.all([
    db.agentAction.findMany({ where: { status: "PROPOSED" }, orderBy: { createdAt: "asc" }, include: { conversation: { select: { id: true, title: true } } } }),
    db.agentAction.findMany({ where: { status: { not: "PROPOSED" } }, orderBy: { decidedAt: "desc" }, take: 50 }),
  ]);
  const ok = aiConfigured();
  return (
    <>
      <PageHeader title="AI Agent · Approvals" subtitle="Everything the AI or an ask-first workflow wants to do waits here until you approve it." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader title={`Waiting for you (${pending.length})`} />
            {pending.length === 0 ? (
              <Empty>Nothing waiting for approval.</Empty>
            ) : (
              <div className="flex flex-col gap-3 p-4">
                {pending.map((a) => (
                  <div key={a.id}>
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{source(a.proposedBy)}</span>·<span>{fmtLocal(a.createdAt, true)}</span>
                      {a.conversation && <>·<Link href={`/assistant/${a.conversation.id}`} className="underline">{a.conversation.title.slice(0, 50)}</Link></>}
                    </div>
                    <ProposalCard p={toProposalView(a)} />
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Recent decisions" />
            {history.length === 0 ? (
              <Empty>No history yet.</Empty>
            ) : (
              <Table>
                <thead><tr><Th>When</Th><Th>Action</Th><Th>From</Th><Th>Result</Th></tr></thead>
                <tbody>
                  {history.map((a) => (
                    <tr key={a.id}>
                      <Td className="whitespace-nowrap text-muted">{a.decidedAt ? fmtLocal(a.decidedAt, true) : "—"}</Td>
                      <Td>{a.summary}<div className="text-xs text-muted">{a.decidedByEmail ? `by ${a.decidedByEmail.split("@")[0]}` : ""}</div></Td>
                      <Td className="text-xs text-muted">{source(a.proposedBy)}</Td>
                      <Td>
                        <Badge tone={a.status === "EXECUTED" ? "green" : a.status === "FAILED" ? "red" : "gray"}>{a.status === "EXECUTED" ? "Done" : a.status === "FAILED" ? "Failed" : "Dismissed"}</Badge>
                        {(a.result || a.error) && <div className="mt-0.5 text-xs text-muted">{a.result ?? a.error}</div>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Daily review" subtitle="The agent reads your portfolio, briefs you on what needs attention, and proposes specific next steps for you to approve." />
            <CardBody className="flex flex-col gap-3 text-sm">
              {ok ? <ActionForm action={startDailyReview} submitLabel="Run today's review" /> : <p className="text-muted">Add ANTHROPIC_API_KEY to .env to turn on the AI.</p>}
              <p className="text-xs text-muted">With <code>AI_DAILY_REVIEW=true</code>, it also runs automatically each morning with your workflows.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="What the agent can do" />
            <CardBody className="text-sm">
              <ul className="list-disc space-y-1 pl-5 text-muted">
                <li>Read everything in the app</li>
                <li>Draft emails and texts</li>
                <li>Suggest tasks, notes, and work orders</li>
                <li>Suggest recording a payment you tell it about</li>
                <li>Suggest posting rent or late fees</li>
              </ul>
              <p className="mt-3 text-xs text-muted">It can&apos;t delete anything, move money, or change leases, and nothing runs without your approval. Every decision is logged here.</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
