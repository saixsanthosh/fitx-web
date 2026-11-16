import type { Metadata } from "next";
import { CircleAlert, CreditCard, IndianRupee, ReceiptText, Users } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { formatIstDate, formatIstDateTime } from "@/lib/time";
import { BILLING_PAGE_SIZE, loadBillingPage } from "./billing-data";
import styles from "./billing.module.css";
import {
  formatInr,
  formatSignedInr,
  monthLabel,
  netPaise,
  parseMode,
  parsePage,
  parsePaymentFilter,
  paymentLabel,
  paymentPill,
  periodLabel,
  refundLabel,
  refundPill,
  subscriptionLabel,
  subscriptionPill,
  type BillingMode,
  type PaymentFilter,
} from "./format";

export const metadata: Metadata = { title: "Billing" };

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

const STATES = {
  service_key_missing: {
    title: "Server data access is not configured",
    body: "Add the server-only Supabase key to the Admin project. It is never sent to the browser.",
  },
  migration_pending: {
    title: "Billing records are not installed yet",
    body: "The billing tables come from migration 20261118190000_fitx_billing_razorpay.sql in the FITX app. Until it is applied, no billing data exists and none is shown.",
  },
  query_failed: {
    title: "Billing data could not be loaded",
    body: "Nothing was substituted. Check the server logs and the database connection.",
  },
} as const;

const PAYMENT_FILTERS: Array<{ value: PaymentFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "captured", label: "Captured" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
];

function Pager({ page, total, href }: { page: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / BILLING_PAGE_SIZE));
  return (
    <div className="table-footer">
      <span>
        Page {page} of {pages} · {total.toLocaleString("en-IN")} records
      </span>
      <div className="pagination-actions">
        {page > 1 && <a className={`quiet-button ${styles.chip}`} href={href(page - 1)}>Previous</a>}
        {page < pages && <a className={`quiet-button ${styles.chip}`} href={href(page + 1)}>Next</a>}
      </div>
    </div>
  );
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const params = await searchParams;
  const query: Query = {
    mode: parseMode(params.mode),
    payments: parsePaymentFilter(params.payments),
    sp: parsePage(params.sp),
    pp: parsePage(params.pp),
  };
  const data = await loadBillingPage({ mode: query.mode, paymentFilter: query.payments, subscribersPage: query.sp, paymentsPage: query.pp });
  const testMode = query.mode === "test";

  return (
    <div className="page-stack">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">SUBSCRIPTIONS & PAYMENTS</p>
          <h1>Billing</h1>
          <p className="page-lede">Only records Razorpay itself reported: signed webhooks and the nightly reconciliation. Amounts in INR, times in IST.</p>
        </div>
        <span className="page-heading-icon"><CreditCard aria-hidden="true" size={20} /></span>
      </div>

      <nav aria-label="Razorpay mode" className={styles.modeSwitch}>
        <a className={`${testMode ? "quiet-button" : "primary-button"} ${styles.chip}`} aria-current={testMode ? undefined : "page"} href={billingHref(query, { mode: "live", sp: 1, pp: 1 })}>
          Live records
        </a>
        <a className={`${testMode ? "primary-button" : "quiet-button"} ${styles.chip}`} aria-current={testMode ? "page" : undefined} href={billingHref(query, { mode: "test", sp: 1, pp: 1 })}>
          Test records
        </a>
      </nav>
      {testMode && (
        <p className="inline-notice" role="note">
          Test mode: payments made with Razorpay test cards. No real money moved, and these records are never counted as revenue.
        </p>
      )}

      {data.state !== "ready" ? (
        <section className="module-state" role="status">
          <span className="module-state-icon"><CircleAlert aria-hidden="true" size={19} /></span>
          <div>
            <p className="eyebrow">BILLING RECORDS</p>
            <h2>{STATES[data.state].title}</h2>
            <p>{STATES[data.state].body}</p>
          </div>
        </section>
      ) : (
        <>
          <section className="metric-grid" aria-label="Verified billing totals">
            <article className="metric-panel">
              <div className="metric-top"><IndianRupee aria-hidden="true" size={19} /><span>Captured − refunded · this IST month</span></div>
              <p className="metric-value">{formatSignedInr(netPaise(data.overview.capturedMonth, data.overview.refundedMonth))}</p>
              <h2>{testMode ? "Test net this month" : "Net revenue this month"}</h2>
            </article>
            <article className="metric-panel">
              <div className="metric-top"><ReceiptText aria-hidden="true" size={19} /><span>{formatInr(data.overview.capturedTotal)} captured · {formatInr(data.overview.refundedTotal)} refunded</span></div>
              <p className="metric-value">{formatSignedInr(netPaise(data.overview.capturedTotal, data.overview.refundedTotal))}</p>
              <h2>{testMode ? "Test net to date" : "Net revenue to date"}</h2>
            </article>
            <article className="metric-panel">
              <div className="metric-top"><Users aria-hidden="true" size={19} /><span>Paid period or renewal grace</span></div>
              <p className="metric-value">{data.overview.subscribersWithAccess.toLocaleString("en-IN")}</p>
              <h2>Subscribers with Premium</h2>
            </article>
            <article className="metric-panel">
              <div className="metric-top"><CircleAlert aria-hidden="true" size={19} /><span>{data.overview.paymentsCaptured30d.toLocaleString("en-IN")} captured in the same period</span></div>
              <p className="metric-value">{data.overview.paymentsFailed30d.toLocaleString("en-IN")}</p>
              <h2>Failed payments · 30 days</h2>
            </article>
          </section>

          <section className="overview-lower">
            <article className="report-panel">
              <div className="section-heading"><div><p className="eyebrow">BY MONTH</p><h2>Captured and refunded</h2></div></div>
              <div className="table-scroll">
                <table className={styles.monthTable}>
                  <thead><tr><th scope="col">Month (IST)</th><th scope="col" className={styles.money}>Captured</th><th scope="col" className={styles.money}>Refunded</th><th scope="col" className={styles.money}>Net</th></tr></thead>
                  <tbody>
                    {data.overview.monthly.map((month) => (
                      <tr key={month.month}>
                        <td><strong>{monthLabel(month.month)}</strong></td>
                        <td className={styles.money}>{formatInr(month.capturedPaise)}</td>
                        <td className={styles.money}>{formatInr(month.refundedPaise)}</td>
                        <td className={styles.money}>{formatSignedInr(netPaise(month.capturedPaise, month.refundedPaise))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
            <article className="report-note">
              <p className="eyebrow">DATA HEALTH</p>
              <h2>Is Razorpay reporting in?</h2>
              <dl className={styles.healthList}>
                <div><dt>Last webhook received</dt><dd>{formatIstDateTime(data.overview.lastWebhookAt) ?? "None yet"}</dd></div>
                <div>
                  <dt>Last reconciliation</dt>
                  <dd>
                    {data.overview.lastReconciliation
                      ? `${formatIstDateTime(data.overview.lastReconciliation.finishedAt) ?? "—"} · ${data.overview.lastReconciliation.checked} checked, ${data.overview.lastReconciliation.corrections} corrected, ${data.overview.lastReconciliation.errors} errors`
                      : "Not run yet"}
                  </dd>
                </div>
                <div><dt>Webhooks ignored · 30 days</dt><dd>{data.overview.webhooksIgnored30d}</dd></div>
                <div><dt>Refunds in progress</dt><dd>{data.overview.refundsPending}</dd></div>
                <div><dt>Razorpay fees to date</dt><dd>{formatInr(data.overview.feesTotal)}</dd></div>
              </dl>
            </article>
          </section>

          <section className="table-panel" aria-labelledby="billing-subscribers">
            <div className="table-heading">
              <div>
                <h2 id="billing-subscribers">Subscribers</h2>
                <p>
                  {Object.entries(data.overview.subscriptionsByStatus).length
                    ? Object.entries(data.overview.subscriptionsByStatus).map(([status, n]) => `${n} ${subscriptionLabel(status).toLowerCase()}`).join(" · ")
                    : "No subscriptions recorded."}
                </p>
              </div>
              <span className="data-badge">Verified records</span>
            </div>
            {data.subscribers.rows.length ? (
              <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">Account</th><th scope="col">Plan</th><th scope="col">Status</th><th scope="col">Premium</th><th scope="col">Paid through</th><th scope="col">Next charge</th><th scope="col">Started</th><th scope="col">Razorpay id</th></tr></thead>
                  <tbody>
                    {data.subscribers.rows.map((row) => (
                      <tr key={row.id}>
                        <td><strong>{row.email ?? "Deleted account"}</strong></td>
                        <td>{row.planName}<span className="table-subline">{formatInr(row.amountPaise)} {periodLabel(row.period, row.interval)}</span></td>
                        <td>
                          <span className={`status-pill ${subscriptionPill(row.status)}`}><i />{subscriptionLabel(row.status)}</span>
                          {row.cancelRequestedAt && <span className="table-subline">Cancelled by member {formatIstDate(row.cancelRequestedAt)}</span>}
                        </td>
                        <td>{row.hasAccess ? "Yes" : "No"}</td>
                        <td>{formatIstDate(row.paidUntil) ?? "—"}</td>
                        <td>{["active", "pending"].includes(row.status) ? formatIstDate(row.chargeAt) ?? "—" : "—"}</td>
                        <td>{formatIstDate(row.createdAt) ?? "—"}</td>
                        <td className="mono-cell">{row.providerId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state"><h3>No subscriptions yet</h3><p>Subscriptions appear here when members start checkout in the FITX app.</p></div>
            )}
            {data.subscribers.total > BILLING_PAGE_SIZE && (
              <Pager page={query.sp} total={data.subscribers.total} href={(page) => billingHref(query, { sp: page })} />
            )}
          </section>

          <section className="table-panel" aria-labelledby="billing-payments">
            <div className="table-heading">
              <div><h2 id="billing-payments">Payments ledger</h2><p>Every payment attempt Razorpay reported for a FITX subscription, newest first.</p></div>
              <span className="data-badge">{data.payments.total.toLocaleString("en-IN")} records</span>
            </div>
            <nav aria-label="Filter payments" className={styles.filterRow}>
              {PAYMENT_FILTERS.map((filter) => (
                <a
                  key={filter.value}
                  className={`${query.payments === filter.value ? "primary-button" : "quiet-button"} ${styles.chip}`}
                  aria-current={query.payments === filter.value ? "page" : undefined}
                  href={billingHref(query, { payments: filter.value, pp: 1 })}
                >
                  {filter.label}
                </a>
              ))}
            </nav>
            {data.payments.rows.length ? (
              <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">Date</th><th scope="col">Account</th><th scope="col">Plan · period</th><th scope="col" className={styles.money}>Amount</th><th scope="col">Status</th><th scope="col">Method</th><th scope="col" className={styles.money}>Refunded</th><th scope="col">Failure reason</th><th scope="col">Razorpay id</th></tr></thead>
                  <tbody>
                    {data.payments.rows.map((row) => (
                      <tr key={row.id}>
                        <td>{formatIstDateTime(row.paidAt) ?? "—"}</td>
                        <td><strong>{row.email ?? "Deleted account"}</strong></td>
                        <td>
                          {row.planName ?? "—"}
                          {row.periodStart && row.periodEnd && <span className="table-subline">{formatIstDate(row.periodStart)} – {formatIstDate(row.periodEnd)}</span>}
                        </td>
                        <td className={styles.money}>{row.currency === "INR" ? formatInr(row.amountPaise) : `${(row.amountPaise / 100).toFixed(2)} ${row.currency}`}</td>
                        <td><span className={`status-pill ${paymentPill(row.status)}`}><i />{paymentLabel(row.status, row.refundedPaise)}</span></td>
                        <td>{row.method ?? "—"}</td>
                        <td className={styles.money}>{row.refundedPaise ? formatInr(row.refundedPaise) : "—"}</td>
                        <td>{row.status === "failed" ? <span className={styles.reason} title={row.errorDescription ?? undefined}>{row.errorDescription ?? row.errorCode ?? "Not given"}</span> : "—"}</td>
                        <td className="mono-cell">{row.providerId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state"><h3>No payments recorded</h3><p>{query.payments === "all" ? "Payments appear once Razorpay reports them." : "No payments with this status."}</p></div>
            )}
            {data.payments.total > BILLING_PAGE_SIZE && (
              <Pager page={query.pp} total={data.payments.total} href={(page) => billingHref(query, { pp: page })} />
            )}
          </section>

          <section className="table-panel" aria-labelledby="billing-refunds">
            <div className="table-heading">
              <div><h2 id="billing-refunds">Refunds</h2><p>Issued from the Razorpay Dashboard; recorded here when Razorpay reports them. Latest {BILLING_PAGE_SIZE}.</p></div>
              <span className="data-badge">{data.refunds.total.toLocaleString("en-IN")} records</span>
            </div>
            {data.refunds.rows.length ? (
              <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">Requested</th><th scope="col">Account</th><th scope="col" className={styles.money}>Amount</th><th scope="col">Status</th><th scope="col">Speed</th><th scope="col">Processed</th><th scope="col">Refund id</th><th scope="col">Payment id</th></tr></thead>
                  <tbody>
                    {data.refunds.rows.map((row) => (
                      <tr key={row.id}>
                        <td>{formatIstDateTime(row.createdAt) ?? "—"}</td>
                        <td><strong>{row.email ?? "Deleted account"}</strong></td>
                        <td className={styles.money}>{formatInr(row.amountPaise)}</td>
                        <td><span className={`status-pill ${refundPill(row.status)}`}><i />{refundLabel(row.status)}</span></td>
                        <td>{row.speed ?? "—"}</td>
                        <td>{formatIstDateTime(row.processedAt) ?? "—"}</td>
                        <td className="mono-cell">{row.providerId}</td>
                        <td className="mono-cell">{row.paymentProviderId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state"><h3>No refunds recorded</h3><p>Refunds made in the Razorpay Dashboard appear here automatically.</p></div>
            )}
          </section>

          <section className="table-panel" aria-labelledby="billing-plans">
            <div className="table-heading">
              <div><h2 id="billing-plans">Plans</h2><p>The billing_plans table. A plan is sold only while it is active and has a Razorpay plan id for the mode in use.</p></div>
            </div>
            {data.plans.length ? (
              <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">Plan</th><th scope="col">Code</th><th scope="col" className={styles.money}>Price</th><th scope="col">Status</th><th scope="col">Test plan id</th><th scope="col">Live plan id</th></tr></thead>
                  <tbody>
                    {data.plans.map((plan) => (
                      <tr key={plan.code}>
                        <td><strong>{plan.name}</strong></td>
                        <td className="mono-cell">{plan.code}</td>
                        <td className={styles.money}>{formatInr(plan.amountPaise)} {periodLabel(plan.period, plan.interval)}</td>
                        <td><span className={`status-pill ${plan.isActive ? "status-good" : "status-neutral"}`}><i />{plan.isActive ? "Active" : "Hidden"}</span></td>
                        <td>{plan.hasTestPlan ? "Set" : "Missing"}</td>
                        <td>{plan.hasLivePlan ? "Set" : "Missing"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state"><h3>No plans yet</h3><p>Plans and prices are added by the owner. Until then the FITX app shows “Subscriptions open soon”.</p></div>
            )}
          </section>
        </>
      )}

      <p className="privacy-note">
        Card numbers, UPI IDs and bank details never reach FITX; Razorpay keeps them. This page shows account emails, amounts, statuses and
        Razorpay reference ids only. Refunds are issued in the Razorpay Dashboard.
      </p>
    </div>
  );
}
