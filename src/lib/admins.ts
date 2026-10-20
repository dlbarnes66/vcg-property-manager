/** Admin emails from ALLOWED_EMAILS (lower-cased). No framework imports, so any module can use it. */
export function adminEmails() {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const isAdminEmail = (email: string) => adminEmails().includes(email.trim().toLowerCase());
