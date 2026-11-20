import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FitxMark } from "@/components/fitx-mark";
import { getAdminOperator } from "@/lib/admin-auth";
import { isConsolePath } from "@/lib/roles";
import { firstParam } from "@/lib/search-params";
import { LoginForm } from "./login-form";
import { LoginStage } from "./login-stage";
import styles from "./login.module.css";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const raw = firstParam(params.next);
  const next = isConsolePath(raw) ? raw : "";
  const operator = await getAdminOperator();
  if (operator) redirect(operator.mustChangePassword ? "/account" : next || "/overview");

  return (
    <main className={styles.page}>
      <LoginStage />
      <section className={styles.panel} aria-labelledby="login-title">
        <div className={styles.card}>
          <div className={styles.cardBrand}><FitxMark size={28} /><span>FITX <em>ADMIN</em></span></div>
          <h1 id="login-title" className={styles.title}>Sign in</h1>
          {firstParam(params.state) === "password_changed" && <p className={styles.notice} role="status">Password changed. Sign in with the new one.</p>}
          <LoginForm next={next} />
          <p className={styles.note}>Private console. Every sign-in is recorded.</p>
        </div>
      </section>
    </main>
  );
}
