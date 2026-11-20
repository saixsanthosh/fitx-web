"use client";

import { useActionState, useRef } from "react";
import { IDLE, type FormState } from "@/lib/content/form";
import styles from "./content.module.css";
import { ChoiceField, TextAreaField, TextField, ToggleField } from "./fields";
import { FormFooter } from "./form-footer";

export type PlanInitial = {
  code: string;
  name: string;
  description: string | null;
  features: string[];
  isActive: boolean;
  sortOrder: number;
  razorpayPlanIdTest: string | null;
  razorpayPlanIdLive: string | null;
  priceLabel: string | null;
};

export function PlanForm({ action, initial, creating }: { action: (state: FormState, form: FormData) => Promise<FormState>; initial: PlanInitial; creating: boolean }) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state.fieldErrors ?? {};
  return (
    <form ref={formRef} action={formAction} className={styles.form} noValidate>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Plan</legend>
        {creating ? (
          <TextField name="code" label="Code" hint="Lower case, for example premium-monthly. It cannot change later." error={errors.code} maxLength={40} />
        ) : (
          <input type="hidden" name="code" value={initial.code} />
        )}
        <TextField name="name" label="Name" defaultValue={initial.name} error={errors.name} maxLength={60} />
        <TextAreaField name="description" label="Description" defaultValue={initial.description ?? ""} error={errors.description} rows={2} maxLength={300} />
        <TextAreaField name="features" label="Features" hint="One per line, at most 10. Shown on the FITX subscription page." defaultValue={initial.features.join("\n")} error={errors.features} rows={5} />
        <div className={styles.grid2}>
          <TextField name="sort_order" label="Order" hint="Lower comes first." inputMode="numeric" defaultValue={initial.sortOrder} error={errors.sort_order} />
          <ToggleField name="is_active" label="On sale" defaultChecked={initial.isActive} hint="Sold only while it has a Razorpay plan id for the mode in use." />
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Price and Razorpay</legend>
        {creating ? (
          <>
            <p className={styles.hint}>Make the plan in the Razorpay Dashboard first, with this exact price. Checkout stops if they differ.</p>
            <div className={styles.grid3}>
              <TextField name="price" label="Price" inputMode="decimal" suffix="INR" error={errors.price} />
              <ChoiceField name="billing_period" label="Billed" multiple={false} selected={["monthly"]} error={errors.billing_period} options={[{ value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly" }]} />
              <TextField name="billing_interval" label="Every" hint="Months between charges (1 for yearly)." inputMode="numeric" defaultValue={1} error={errors.billing_interval} />
            </div>
          </>
        ) : (
          <p className={styles.hint}>
            {initial.priceLabel}. Razorpay fixes the price on its plan: to charge a different amount, make a new plan there and here.
          </p>
        )}
        <div className={styles.grid2}>
          {initial.razorpayPlanIdTest ? (
            <p className={styles.hint}>Test plan <span className={styles.mono}>{initial.razorpayPlanIdTest}</span></p>
          ) : (
            <TextField name="razorpay_plan_id_test" label="Razorpay test plan id" placeholder="plan_…" error={errors.razorpay_plan_id_test} maxLength={70} />
          )}
          {initial.razorpayPlanIdLive ? (
            <p className={styles.hint}>Live plan <span className={styles.mono}>{initial.razorpayPlanIdLive}</span></p>
          ) : (
            <TextField name="razorpay_plan_id_live" label="Razorpay live plan id" placeholder="plan_…" error={errors.razorpay_plan_id_live} maxLength={70} />
          )}
        </div>
      </fieldset>

      <FormFooter state={state} pending={pending} label={creating ? "Add plan" : "Save plan"} formRef={formRef} />
    </form>
  );
}
