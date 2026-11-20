import type { Metadata } from "next";
import { ContentHeader, contentStyles as styles } from "@/components/content/kit";
import { PlanForm } from "@/components/content/plan-form";
import { requireAdmin } from "@/lib/admin-auth";
import { savePlan } from "../../actions";

export const metadata: Metadata = { title: "Add plan" };

export default async function NewPlanPage() {
  await requireAdmin("billing.manage");
  return (
    <div className={styles.page}>
      <ContentHeader eyebrow="05 Subscriptions" title="Add plan" back={{ href: "/billing", label: "Subscriptions" }} meta="It starts off sale unless you turn it on." />
      <PlanForm
        action={savePlan.bind(null, null)}
        creating
        initial={{ code: "", name: "", description: null, features: [], isActive: false, sortOrder: 0, razorpayPlanIdTest: null, razorpayPlanIdLive: null, priceLabel: null }}
      />
    </div>
  );
}
