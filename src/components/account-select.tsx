import type { AccountType } from "@prisma/client";
import { db } from "@/lib/db";
import { Select } from "@/components/ui";

const typeLabel: Record<AccountType, string> = { ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Expenses" };

export async function accountOptions(filter?: { types?: AccountType[]; bankOnly?: boolean }) {
  return db.account.findMany({
    where: { active: true, ...(filter?.types ? { type: { in: filter.types } } : {}), ...(filter?.bankOnly ? { isBank: true } : {}) },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true },
  });
}

/** Account dropdown grouped by type. */
export async function AccountSelect({
  name, defaultValue, types, bankOnly, required = true, placeholder = "Choose an account…",
}: {
  name: string;
  defaultValue?: string | null;
  types?: AccountType[];
  bankOnly?: boolean;
  required?: boolean;
  placeholder?: string;
}) {
  const accts = await accountOptions({ types, bankOnly });
  const groups = (Object.keys(typeLabel) as AccountType[]).map((t) => [t, accts.filter((a) => a.type === t)] as const).filter(([, a]) => a.length);
  return (
    <Select name={name} defaultValue={defaultValue ?? (bankOnly && accts[0] ? accts[0].id : "")} required={required}>
      {!bankOnly && <option value="">{placeholder}</option>}
      {groups.map(([t, list]) => (
        <optgroup key={t} label={typeLabel[t]}>
          {list.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}

export async function PropertySelect({ name = "propertyId", defaultValue, blank = "All / none" }: { name?: string; defaultValue?: string | null; blank?: string }) {
  const props = await db.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <Select name={name} defaultValue={defaultValue ?? ""}>
      <option value="">{blank}</option>
      {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </Select>
  );
}
