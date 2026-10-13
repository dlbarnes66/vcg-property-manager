import { Sidebar } from "@/components/sidebar";
import { requireAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAccess();
  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="px-4 py-6 sm:px-8 lg:ml-60 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
