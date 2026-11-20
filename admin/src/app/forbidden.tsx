import Link from "next/link";
import { LogOut, ShieldAlert } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { FitxMark } from "@/components/fitx-mark";

/**
 * The 403 page: the signed-in operator's role does not include this page. It renders outside the
 * shell, so it carries its own Sign out: /login sends a signed-in operator straight back to Admin.
 */
export default function Forbidden() {
  return (
    <main className="access-page">
      <div className="access-card">
        <span className="access-brand"><FitxMark size={34} /><span>FITX <em>ADMIN</em></span></span>
        <div className="access-icon"><ShieldAlert aria-hidden="true" size={25} /></div>
        <p className="eyebrow">403</p>
        <h1>No access</h1>
        <p>Your role does not include this page.</p>
        <div className="access-actions">
          <Link href="/" className="text-link">Back to Admin</Link>
          <form action={signOut}>
            <button type="submit" className="signout-button"><LogOut aria-hidden="true" size={16} />Sign out</button>
          </form>
        </div>
      </div>
    </main>
  );
}
