import { AdminShell } from "@/components/admin/AdminShell";
import { AdminBetaConsole } from "@/components/admin/AdminBetaConsole";

// /admin/beta — private-beta waitlist console (docs/BETA.md). Privy login is
// required and the API answers 403 for non-admins; the console renders both gates.
export default function AdminBetaPage() {
  return (
    <AdminShell>
      <AdminBetaConsole />
    </AdminShell>
  );
}
