import { redirect } from "next/navigation";

// The audit log moved into Settings (admin-only tab) — keep old bookmarks
// and deep links working.
export default function AuditRedirect() {
  redirect("/settings?tab=audit");
}
