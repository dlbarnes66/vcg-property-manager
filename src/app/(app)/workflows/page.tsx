import type { Workflow } from "@prisma/client";
import { Zap } from "lucide-react";
import { db } from "@/lib/db";
import { ACTIONS, TRIGGERS } from "@/lib/workflows";
import { ActionForm } from "@/components/action-form";
import { EditPopover } from "@/components/edit-popover";
import { WorkflowForm } from "@/components/workflow-form";
import { Badge, Card, CardBody, CardHeader, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { fmtLocal } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { addStarters, deleteWorkflow, previewWorkflow, runAllNow, runOneNow, saveWorkflow, toggleWorkflow } from "./actions";

export const metadata = { title: "Workflows" };

function sentence(w: Workflow & { template: { name: string } | null; property: { name: string } | null }) {
  const n = w.days;
  const when =
    w.trigger === "MONTHLY" ? `On day ${n} of each month` :
    w.trigger === "RENT_DUE_SOON" ? `When rent is due within ${n} day${n === 1 ? "" : "s"}` :
    w.trigger === "RENT_PAST_DUE" ? `When a tenant is ${n}+ day${n === 1 ? "" : "s"} past due` :
    w.trigger === "LEASE_ENDING" ? `When a lease ends within ${n} days` :
    w.trigger === "RECERT_DUE" ? `When a recertification is within ${n} days` :
    w.trigger === "INSPECTION_UPCOMING" ? `When an inspection is within ${n} days` :
    `When ${TRIGGERS[w.trigger].label.toLowerCase()}`;
  const what =
    w.action === "SEND_TEMPLATE" ? `${w.channel === "SMS" ? "text" : "email"} the tenant "${w.template?.name ?? "(deleted template)"}"` :
    w.action === "CREATE_TASK" ? `create a task: "${w.taskTitle}"` :
    w.action === "NOTIFY_ME" ? "email me" : ACTIONS[w.action].label.toLowerCase();
  return `${when}${w.property ? ` at ${w.property.name}` : ""}, ${what}${w.requireApproval ? " (after I approve)" : ""}.`;
}

export default async function WorkflowsPage() {
  const [flows, templates, properties, runs, firings] = await Promise.all([
    db.workflow.findMany({ orderBy: [{ enabled: "desc" }, { createdAt: "asc" }], include: { template: { select: { name: true } }, property: { select: { name: true } }, _count: { select: { firings: true } } } }),
    db.messageTemplate.findMany({ orderBy: { name: "asc" }, where: { channel: { in: ["EMAIL", "SMS"] } } }),
    db.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.workflowRun.findMany({ orderBy: { startedAt: "desc" }, take: 15, include: { workflow: { select: { name: true } } } }),
    db.workflowFiring.findMany({ orderBy: { createdAt: "desc" }, take: 25, include: { workflow: { select: { name: true } } } }),
  ]);
  const tplOpts = templates.map((t) => ({ id: t.id, label: t.name, channel: t.channel }));
  const propOpts = properties.map((p) => ({ id: p.id, label: p.name }));
  const scheduled = Boolean(process.env.CRON_SECRET);

  return (
    <>
      <PageHeader
        title="Workflows"
        subtitle={scheduled ? "Enabled workflows run automatically every morning (see README to run them hourly)." : "Runs when you click Run. Set CRON_SECRET and deploy to run them automatically every morning."}
        actions={<ActionForm action={runAllNow} submitLabel="Run all now" inline />}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {flows.length === 0 ? (
            <Card>
              <Empty action={<ActionForm action={addStarters} submitLabel="Add starter workflows" inline />}>
                No workflows yet. Start with rent reminders, recert prep, renewal tasks, failed-inspection tasks, and posting rent on the 1st. They&apos;re added turned off so you can preview each one first.
              </Empty>
            </Card>
          ) : (
            flows.map((w) => (
              <Card key={w.id} className={cn(!w.enabled && "opacity-75")}>
                <div className="flex items-start gap-3 p-4">
                  <Zap size={18} className={cn("mt-0.5 shrink-0", w.enabled ? "text-gold" : "text-muted")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{w.name}</span>
                      <Badge tone={w.enabled ? "green" : "gray"}>{w.enabled ? "On" : "Off"}</Badge>
                      {w.requireApproval && <Badge tone="amber">Ask first</Badge>}
                    </div>
                    <p className="mt-0.5 text-sm text-muted">{sentence(w)}</p>
                    <p className="mt-1 text-xs text-muted">{w._count.firings} handled so far{w.lastRunAt ? ` · last run ${fmtLocal(w.lastRunAt, true)}` : ""}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ActionForm action={toggleWorkflow.bind(null, w.id)} submitLabel={w.enabled ? "Turn off" : "Turn on"} submitVariant={w.enabled ? "secondary" : "primary"} inline />
                      <ActionForm action={previewWorkflow.bind(null, w.id)} submitLabel="Preview" submitVariant="secondary" inline />
                      <ActionForm action={runOneNow.bind(null, w.id)} submitLabel="Run now" submitVariant="ghost" inline confirm={`Run "${w.name}" now?`} />
                      <EditPopover title={`Edit "${w.name}"`}>
                        <WorkflowForm action={saveWorkflow.bind(null, w.id)} templates={tplOpts} properties={propOpts} defaults={w} submitLabel="Save workflow" />
                        <div className="mt-3 border-t border-line pt-3">
                          <ActionForm action={deleteWorkflow.bind(null, w.id)} submitLabel="Delete workflow" submitVariant="danger" confirm="Delete this workflow and its history?" />
                        </div>
                      </EditPopover>
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}

          <Card>
            <CardHeader title="Recent activity" subtitle="Each workflow handles a given tenant or event once." />
            {firings.length === 0 ? (
              <Empty>Nothing yet.</Empty>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {firings.map((f) => (
                  <li key={f.id} className="flex items-start gap-3 px-5 py-2.5">
                    <span className="w-32 shrink-0 text-xs text-muted">{fmtLocal(f.createdAt, true)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{f.workflow.name}</span>
                      <span className={cn("block text-xs", f.ok ? "text-muted" : "text-amber-700")}>{f.outcome}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="New workflow" />
            <CardBody>
              <WorkflowForm action={saveWorkflow.bind(null, null)} templates={tplOpts} properties={propOpts} submitLabel="Create workflow" />
              {flows.length > 0 && <div className="mt-4 border-t border-line pt-4"><ActionForm action={addStarters} submitLabel="Add starter workflows" submitVariant="ghost" inline /></div>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Runs" />
            {runs.length === 0 ? (
              <Empty>No runs yet.</Empty>
            ) : (
              <Table>
                <thead><tr><Th>When</Th><Th>Workflow</Th><Th className="text-right">Did</Th></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <Td className="text-xs whitespace-nowrap text-muted">{fmtLocal(r.startedAt, true)}<div>{r.source}</div></Td>
                      <Td className="text-xs">{r.workflow?.name ?? "—"}{r.error && <div className="text-red-700">{r.error.slice(0, 120)}</div>}</Td>
                      <Td className="tabular text-right text-xs">{r.fired}{r.failed ? <span className="text-red-700"> / {r.failed} failed</span> : ""}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
