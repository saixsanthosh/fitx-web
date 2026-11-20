import Link from "next/link";
import { SearchX } from "lucide-react";
import { FitxMark } from "@/components/fitx-mark";

export default function NotFound() {
  return (
    <main className="access-page">
      <div className="access-card">
        <span className="access-brand"><FitxMark size={34} /><span>FITX <em>ADMIN</em></span></span>
        <div className="access-icon"><SearchX aria-hidden="true" size={25} /></div>
        <p className="eyebrow">404</p>
        <h1>Not found</h1>
        <p>This page or record does not exist.</p>
        <div className="access-actions"><Link href="/" className="text-link">Back to Admin</Link></div>
      </div>
    </main>
  );
}
