import { syncLedger } from "@/lib/accounting";
import { AccountingNav } from "@/components/accounting-nav";
import { PageHeader } from "@/components/ui";

export const metadata = { title: { default: "Accounting", template: "%s · Accounting" } };

export default async function AccountingLayout({ children }: { children: React.ReactNode }) {
  // Post any new charges, payments, and bills before showing the books.
  await syncLedger();
  return (
    <>
      <PageHeader title="Accounting" subtitle="Property books (accrual basis). Fund-level books are kept by your fund administrator." />
      <AccountingNav />
      {children}
    </>
  );
}
