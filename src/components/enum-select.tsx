import { Select } from "@/components/ui";
import { titleCase } from "@/lib/utils";

export function EnumSelect({
  name,
  values,
  defaultValue,
  includeBlank,
  labels,
  required,
}: {
  name: string;
  values: readonly string[];
  defaultValue?: string | null;
  includeBlank?: string;
  labels?: Record<string, string>;
  required?: boolean;
}) {
  return (
    <Select name={name} defaultValue={defaultValue ?? ""} required={required}>
      {includeBlank !== undefined && <option value="">{includeBlank}</option>}
      {values.map((v) => (
        <option key={v} value={v}>
          {labels?.[v] ?? titleCase(v)}
        </option>
      ))}
    </Select>
  );
}
