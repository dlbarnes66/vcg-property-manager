/** The 50 states + DC, for the forms library and anywhere else a state is picked. */
export const STATES: { code: string; name: string }[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"],
  ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"],
  ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
].map(([code, name]) => ({ code, name }));

/** "US" = applies in every state (federal forms like the lead paint disclosure). */
export const ALL_STATES_CODE = "US";
const byCode = new Map(STATES.map((s) => [s.code, s.name]));
export const stateName = (code: string | null | undefined) => (code === ALL_STATES_CODE ? "All states (federal)" : code ? (byCode.get(code) ?? code) : "—");
export const isStateCode = (code: unknown): code is string => typeof code === "string" && (byCode.has(code) || code === ALL_STATES_CODE);
/** Best guess at a state code from free text ("AL", "Alabama", "al "). */
export function toStateCode(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  const up = t.toUpperCase();
  if (byCode.has(up)) return up;
  return STATES.find((x) => x.name.toLowerCase() === t.toLowerCase())?.code ?? null;
}
