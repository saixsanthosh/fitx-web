import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { signOut } from "@/app/signin/actions";
import { FitxMark } from "@/components/fitx-mark";

const states: Record<string, { title: string; detail: string }> = {
  configuration: { title: "Admin setup is incomplete", detail: "The Admin environment is missing required configuration, such as the Supabase settings or the approved email list." },
  setup_pending: { title: "Owner setup is pending", detail: "The role and audit schema has not been initialized. No administrator can grant access from this screen." },
  service_key_missing: { title: "Secure data access is not configured", detail: "The server-only Supabase secret key is missing from this environment." },
  not_authorized: { title: "This account does not have Admin access", detail: "Ask the FITX owner to approve this Google account. Admin registration is closed." },
  forbidden: { title: "Your role does not include this page", detail: "Your Admin role does not grant this area. Ask a super-admin if you need it." },
};

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const params = await searchParams;
  const forbidden = params.state === "forbidden";
  const state = states[params.state ?? ""] ?? states.not_authorized;

  return (
    <main className="access-page">
      <div className="access-card">
        <Link href="/signin" className="access-brand"><FitxMark size={34} /><span>FITX <em>ADMIN</em></span></Link>
        <div className="access-icon"><ShieldAlert aria-hidden="true" size={25} /></div>
        <p className="eyebrow">Access check</p>
        <h1>{state.title}</h1>
        <p>{state.detail}</p>
        <div className="access-actions">
          {forbidden ? <Link href="/overview" className="text-link">Back to the overview</Link> : <Link href="/signin" className="text-link">Return to sign in</Link>}
          <form action={signOut}><button className="quiet-button" type="submit">Sign out</button></form>
        </div>
      </div>
    </main>
  );
}
