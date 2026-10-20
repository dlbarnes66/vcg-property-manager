import { Sidebar } from "@/components/sidebar";
import { requireAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { todayUTC } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAccess();
  // Sidebar badges: tasks due today or overdue, unread text replies, new rental applications
  const [tasks, messages, applications, approvals] = await Promise.all([
    db.task.count({ where: { status: { not: "DONE" }, dueDate: { lte: todayUTC() } } }),
    db.message.count({ where: { direction: "INBOUND", readAt: null } }),
    db.application.count({ where: { status: "NEW" } }),
    db.agentAction.count({ where: { status: "PROPOSED" } }),
  ]);
  return (
    <div className="min-h-screen">
      <Sidebar counts={{ tasks, messages, applications, approvals }} />
      <main className="px-4 py-6 sm:px-8 lg:ml-60 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
