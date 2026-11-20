import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { FitxMark } from "@/components/fitx-mark";

/** The 403 page: the signed-in operator's role does not include this page. */
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
          <Link href="/login" className="text-link">Switch account</Link>
        </div>
      </div>
    </main>
  );
}
