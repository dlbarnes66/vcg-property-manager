import { db } from "@/lib/db";
import { Select } from "@/components/ui";

export async function UnitSelect({ name = "unitId", defaultValue, required = true }: { name?: string; defaultValue?: string; required?: boolean }) {
  const properties = await db.property.findMany({ orderBy: { name: "asc" }, include: { units: { orderBy: { label: "asc" } } } });
  return (
    <Select name={name} defaultValue={defaultValue ?? ""} required={required}>
      <option value="">Select a unit…</option>
      {properties.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {p.units.map((u) => (
            <option key={u.id} value={u.id}>
              {p.name} · {u.label}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

export const maintTone = (s: string) =>
  ({ OPEN: "red", SCHEDULED: "blue", IN_PROGRESS: "amber", COMPLETED: "green", CANCELLED: "gray" })[s] as "red" | "blue" | "amber" | "green" | "gray";
export const priorityTone = (p: string) =>
  ({ LOW: "gray", NORMAL: "gray", HIGH: "amber", EMERGENCY: "red" })[p] as "gray" | "amber" | "red";
