import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Plus } from "lucide-react";
import { BarChart } from "@/components/content/charts";
import { ContentHeader, ContentTabs, Empty, Notice, Pager, Pill, Section, Stat, Stats, contentStyles as styles } from "@/components/content/kit";
import { ModuleState } from "@/components/module-state";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { BILLING_PAGE_SIZE, loadBillingPage } from "@/lib/data/billing";
import { formatIstDate, formatIstDateTime } from "@/lib/time";
import {
  canRefund,
  formatInr,
  formatSignedInr,
  lastCoveredInstant,
  monthLabel,
  netPaise,
  parseMode,
  parsePage,
  parsePaymentFilter,
  paymentLabel,
  periodLabel,
  razorpayPaymentUrl,
  refundLabel,
  subscriptionLabel,
  type BillingMode,
  type PaymentFilter,
} from "./format";

export const metadata: Metadata = { title: "Subscriptions" };

type Search = { mode?: string; payments?: string; sp?: string; pp?: string };
type Query = { mode: BillingMode; payments: PaymentFilter; sp: number; pp: number };

function billingHref(query: Query, change: Partial<Query>) {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  if (next.mode !== "live") params.set("mode", next.mode);
  if (next.payments !== "all") params.set("payments", next.payments);
  if (next.sp > 1) params.set("sp", String(next.sp));
  if (next.pp > 1) params.set("pp", String(next.pp));
  const search = params.toString();
  return search ? `/billing?${search}` : "/billing";
}

const tone = (status: string): "good" | "bad" | "neutral" => (status === "active" || status === "captured" || status === "processed" ? "good" : status === "halted" || status === "failed" ? "bad" : "neutral");

const PAYMENT_FILTERS: Array<{ value: PaymentFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "captured", label: "Captured" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
];

export default async function BillingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const operator = await requireAdmin("billing.view");
  const params = await searchParams;
  const query: Query = { mode: parseMode(params.mode), payments: parsePaymentFilter(params.payments), sp: parsePage(params.sp), pp: parsePage(params.pp) };
  const data = await loadBillingPage({ mode: query.mode, paymentFilter: query.payments, subscribersPage: query.sp, paymentsPage: query.pp });
  const testMode = query.mode === "test";
  const canManage = hasPermission(operator, "billing.manage");

  return (
    <div className={styles.page}>
      <ContentHeader
        eyebrow="05 Subscriptions"
        title="Subscriptions"
        meta="Only what Razorpay reported: signed webhooks and the nightly check. INR, times in IST."
        actions={canManage ? <Link className={styles.button} href="/billing/plans/new"><Plus aria-hidden="true" size={16} />Add plan</Link> : undefined}
      />
      <ContentTabs
        label="Razorpay mode"
        items={[
          { href: billingHref(query, { mode: "live", sp: 1, pp: 1 }), label: "Live", current: !testMode },
          { href: billingHref(query, { mode: "test", sp: 1, pp: 1 }), label: "Test", current: testMode },
        ]}
      />
      {testMode && <Notice good>Test mode: Razorpay test cards. No real money moved and none of it counts as revenue.</Notice>}

      {data.state !== "ready" ? (
        <ModuleState state={data.state} migration={data.state === "migration_pending" ? "20261118190000_fitx_billing_razorpay" : undefined} />
      ) : (
        <>
          <Stats label="Verified totals">
            <Stat label={testMode ? "Test net this month" : "Net revenue this month"} value={netPaise(data.overview.capturedMonth, data.overview.refundedMonth)} display={formatSignedInr(netPaise(data.overview.capturedMonth, data.overview.refundedMonth))} hint="Captured minus refunded, IST month" />
            <Stat label={testMode ? "Test net to date" : "Net revenue to date"} value={netPaise(data.overview.capturedTotal, data.overview.refundedTotal)} display={formatSignedInr(netPaise(data.overview.capturedTotal, data.overview.refundedTotal))} hint={`${formatInr(data.overview.capturedTotal)} captured · ${formatInr(data.overview.refundedTotal)} refunded`} />
            <Stat label="Members with Premium" value={data.overview.subscribersWithAccess} hint="Paid period or renewal grace" />
            <Stat label="Failed payments · 30 days" value={data.overview.paymentsFailed30d} hint={`${data.overview.paymentsCaptured30d.toLocaleString("en-IN")} captured`} />
          </Stats>

          <Section title="Plans" note="Prices are fixed by each Razorpay plan.">
            {data.plans.length ? (
              <ul className={styles.vocab}>
                {data.plans.map((plan) => {
                  const body = (
                    <>
                      <strong>{plan.name}</strong>
                      <span className={styles.vocabCount}>{formatInr(plan.amountPaise)}</span>
                      <span>{periodLabel(plan.period, plan.interval)} · {plan.isActive ? "On sale" : "Off sale"}</span>
                      <span>{plan.features.length ? plan.features.slice(0, 3).join(" · ") : "No features listed"}</span>
                      <span>Test plan {plan.hasTestPlan ? "set" : "missing"} · live plan {plan.hasLivePlan ? "set" : "missing"}</span>
                    </>
                  );
                  return (
                    <li key={plan.code}>
                      {canManage ? <Link className={styles.vocabItem} href={`/billing/plans/${plan.code}`}>{body}</Link> : <div className={styles.vocabItem}>{body}</div>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className={styles.panel}>
                <Empty title="No plans yet">
                  <p>Until one is on sale the FITX app shows that subscriptions open soon.</p>
                  {canManage && <Link className={styles.button} href="/billing/plans/new">Add plan</Link>}
                </Empty>
              </div>
            )}
          </Section>

          <div className={`${styles.split}`}>
            <Section title="By month" note="Captured, IST months">
              <div className={`${styles.panel} ${styles.panelPad}`}>
                {data.overview.monthly.length ? (
                  <BarChart label="Captured payments by month" tone="accent" format={formatInr} points={[...data.overview.monthly].reverse().map((month) => ({ label: monthLabel(month.month), value: month.capturedPaise }))} />
                ) : (
                  <Empty title="No payments yet" />
                )}
                {data.overview.monthly.length > 0 && (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead><tr><th scope="col">Month</th><th scope="col" className={styles.num}>Captured</th><th scope="col" className={styles.num}>Refunded</th><th scope="col" className={styles.num}>Net</th></tr></thead>
                      <tbody>
                        {data.overview.monthly.map((month) => (
                          <tr key={month.month}>
                            <td><strong>{monthLabel(month.month)}</strong></td>
                            <td className={styles.num}>{formatInr(month.capturedPaise)}</td>
                            <td className={styles.num}>{formatInr(month.refundedPaise)}</td>
                            <td className={styles.num}>{formatSignedInr(netPaise(month.capturedPaise, month.refundedPaise))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Section>
            <Section title="Data health">
              <dl className={`${styles.facts} ${styles.panel} ${styles.panelPad}`}>
                <div><dt>Last webhook</dt><dd>{formatIstDateTime(data.overview.lastWebhookAt) ?? "None yet"}</dd></div>
                <div>
                  <dt>Last nightly check</dt>
                  <dd>
                    {data.overview.lastReconciliation
                      ? `${formatIstDateTime(data.overview.lastReconciliation.finishedAt) ?? "–"} · ${data.overview.lastReconciliation.corrections} corrected, ${data.overview.lastReconciliation.errors} errors`
                      : "Not run yet"}
                  </dd>
                </div>
                <div><dt>Webhooks ignored · 30 days</dt><dd>{data.overview.webhooksIgnored30d.toLocaleString("en-IN")}</dd></div>
                <div><dt>Refunds in progress</dt><dd>{data.overview.refundsPending.toLocaleString("en-IN")}</dd></div>
                <div><dt>Razorpay fees to date</dt><dd>{formatInr(data.overview.feesTotal)}</dd></div>
              </dl>
            </Section>
          </div>

          <Section
            title="Subscribers"
            id="subscribers"
            note={Object.entries(data.overview.subscriptionsByStatus).map(([status, n]) => `${n.toLocaleString("en-IN")} ${subscriptionLabel(status).toLowerCase()}`).join(" · ") || undefined}
          >
            <div className={styles.panel}>
              {data.subscribers.rows.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th scope="col">Account</th><th scope="col">Plan</th><th scope="col">Status</th><th scope="col">Paid through</th><th scope="col">Next charge</th><th scope="col">Started</th><th scope="col">Razorpay id</th></tr></thead>
                    <tbody>
                      {data.subscribers.rows.map((row) => (
                        <tr key={row.id}>
                          <td><strong>{row.email ?? "Deleted account"}</strong></td>
                          <td>{row.planName}<span className={styles.sub}>{formatInr(row.amountPaise)} {periodLabel(row.period, row.interval)}</span></td>
                          <td>
                            <Pill tone={tone(row.status)}>{subscriptionLabel(row.status)}</Pill>
                            {row.cancelRequestedAt && <span className={styles.sub}>Cancelled by member {formatIstDate(row.cancelRequestedAt)}</span>}
                          </td>
                          <td>{formatIstDate(lastCoveredInstant(row.paidUntil)) ?? "–"}</td>
                          <td>{["active", "pending"].includes(row.status) ? formatIstDate(row.chargeAt) ?? "–" : "–"}</td>
                          <td>{formatIstDate(row.createdAt) ?? "–"}</td>
                          <td className={styles.mono}>{row.providerId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="No subscriptions yet" />
              )}
              {data.subscribers.total > BILLING_PAGE_SIZE && <Pager page={query.sp} total={data.subscribers.total} pageSize={BILLING_PAGE_SIZE} href={(page) => billingHref(query, { sp: page })} />}
            </div>
          </Section>

          <Section title="Payments" id="payments" note="Newest first. Refunds are issued in Razorpay.">
            <ContentTabs
              label="Filter payments"
              items={PAYMENT_FILTERS.map((filter) => ({ href: billingHref(query, { payments: filter.value, pp: 1 }), label: filter.label, current: query.payments === filter.value }))}
            />
            <div className={styles.panel}>
              {data.payments.rows.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th scope="col">Date</th><th scope="col">Account</th><th scope="col">Plan</th><th scope="col" className={styles.num}>Amount</th><th scope="col">Status</th><th scope="col">Method</th><th scope="col" className={styles.num}>Refunded</th><th scope="col">Reason</th><th scope="col">Refund</th></tr></thead>
                    <tbody>
                      {data.payments.rows.map((row) => {
                        const dashboard = canRefund(row) ? razorpayPaymentUrl(row.providerId) : null;
                        return (
                          <tr key={row.id}>
                            <td>{formatIstDateTime(row.paidAt) ?? "–"}<span className={`${styles.sub} ${styles.mono}`}>{row.providerId}</span></td>
                            <td><strong>{row.email ?? "Deleted account"}</strong></td>
                            <td>
                              {row.planName ?? "–"}
                              {row.periodStart && row.periodEnd && <span className={styles.sub}>{formatIstDate(row.periodStart)} – {formatIstDate(lastCoveredInstant(row.periodEnd))}</span>}
                            </td>
                            <td className={styles.num}>{row.currency === "INR" ? formatInr(row.amountPaise) : `${(row.amountPaise / 100).toFixed(2)} ${row.currency}`}</td>
                            <td><Pill tone={tone(row.status)}>{paymentLabel(row.status, row.refundedPaise)}</Pill></td>
                            <td>{row.method ?? "–"}</td>
                            <td className={styles.num}>{row.refundedPaise ? formatInr(row.refundedPaise) : "–"}</td>
                            <td>{row.status === "failed" ? row.errorDescription ?? row.errorCode ?? "Not given" : "–"}</td>
                            <td>
                              {dashboard ? (
                                <a className={`${styles.buttonQuiet} ${styles.small}`} href={dashboard} target="_blank" rel="noopener noreferrer">
                                  In Razorpay <ExternalLink aria-hidden="true" size={13} />
                                  <span className={styles.srOnly}>(opens in a new tab)</span>
                                </a>
                              ) : (
                                "–"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title={query.payments === "all" ? "No payments recorded" : "None with this status"} />
              )}
              {data.payments.total > BILLING_PAGE_SIZE && <Pager page={query.pp} total={data.payments.total} pageSize={BILLING_PAGE_SIZE} href={(page) => billingHref(query, { pp: page })} />}
            </div>
          </Section>

          <Section title="Refunds" id="refunds" note={`Latest ${BILLING_PAGE_SIZE}, as Razorpay reported them`}>
            <div className={styles.panel}>
              {data.refunds.rows.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th scope="col">Requested</th><th scope="col">Account</th><th scope="col" className={styles.num}>Amount</th><th scope="col">Status</th><th scope="col">Speed</th><th scope="col">Processed</th><th scope="col">Refund id</th></tr></thead>
                    <tbody>
                      {data.refunds.rows.map((row) => (
                        <tr key={row.id}>
                          <td>{formatIstDateTime(row.createdAt) ?? "–"}</td>
                          <td><strong>{row.email ?? "Deleted account"}</strong></td>
                          <td className={styles.num}>{formatInr(row.amountPaise)}</td>
                          <td><Pill tone={tone(row.status)}>{refundLabel(row.status)}</Pill></td>
                          <td>{row.speed ?? "–"}</td>
                          <td>{formatIstDateTime(row.processedAt) ?? "–"}</td>
                          <td className={styles.mono}>{row.providerId}<span className={styles.sub}>{row.paymentProviderId}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="No refunds recorded" />
              )}
            </div>
          </Section>
        </>
      )}

      <p className={styles.hint}>
        Refunds: Admin holds no Razorpay key and moves no money. Open the payment in the Razorpay Dashboard to refund it; the refund appears here when Razorpay reports it. FITX keeps no card, UPI or bank details: the server drops the ones Razorpay&apos;s notices carry.
      </p>
    </div>
  );
}
