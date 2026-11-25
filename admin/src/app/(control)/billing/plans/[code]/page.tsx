import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentHeader, DataState, StateNotice, contentStyles as styles } from "@/components/content/kit";
import { PlanForm } from "@/components/content/plan-form";
import { requireAdmin } from "@/lib/admin-auth";
import { PLAN_CODE } from "@/lib/content/plan-input";
import { loadPlan } from "@/lib/data/billing";
import { pageNotice } from "@/lib/notice";
import { savePlan } from "../../actions";
import { formatInr, periodLabel } from "../../format";

export const metadata: Metadata = { title: "Plan" };

export default async function PlanPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("billing.manage");
  const { code } = await params;
  if (!PLAN_CODE.test(code)) notFound();
  const query = await searchParams;
  const result = await loadPlan(code);
  if (result.state === "not_found") notFound();
  if (result.state !== "ready") {
    return (
      <div className={styles.page}>
        <ContentHeader eyebrow="05 Subscriptions" title="Plan" back={{ href: "/billing", label: "Subscriptions" }} />
        <DataState state={result.state} />
      </div>
    );
  }
  const { plan } = result;
  const price = `${formatInr(plan.amountPaise)} ${periodLabel(plan.period, plan.interval)}`;
  return (
    <div className={styles.page}>
      <ContentHeader eyebrow="05 Subscriptions" title={plan.name} back={{ href: "/billing", label: "Subscriptions" }} meta={`${price} · ${plan.code}`} />
      <StateNotice code={pageNotice(query.state, actor.id)?.code} messages={{ created: { text: "Plan added.", good: true } }} />
      <PlanForm
        action={savePlan.bind(null, plan.code)}
        creating={false}
        initial={{
          code: plan.code,
          name: plan.name,
          description: plan.description,
          features: plan.features,
          isActive: plan.isActive,
          sortOrder: plan.sortOrder,
          razorpayPlanIdTest: plan.razorpayPlanIdTest,
          razorpayPlanIdLive: plan.razorpayPlanIdLive,
          priceLabel: price,
        }}
      />
    </div>
  );
}
