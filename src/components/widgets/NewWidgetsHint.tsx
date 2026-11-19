"use client";

import { useId } from "react";
import { Sparkles } from "lucide-react";
import { WIDGETS, widgetNames, type WidgetId } from "@/lib/domain/dashboard-layout";
import styles from "./Widgets.module.css";

/**
 * Offers widgets released after the member arranged Home, once: "Add to Home" shows them, "Not now" keeps Home
 * as it is (and saves that, so the offer does not come back). Either way they stay in Customise.
 */
export function NewWidgetsHint({ ids, onAnswer }: { ids: readonly WidgetId[]; onAnswer: (answer: "add" | "dismiss") => void }) {
  const id = useId();
  if (!ids.length) return null;
  return (
    <section className={styles.hint} aria-labelledby={id}>
      <span className={styles.hintIcon} aria-hidden="true"><Sparkles size={18} /></span>
      <div className={styles.hintText}>
        <h2 id={id}>New on Home: {widgetNames(ids)}</h2>
        <ul>
          {ids.map((widget) => <li key={widget}><strong>{WIDGETS[widget].title}</strong>: {WIDGETS[widget].description.toLowerCase()}</li>)}
        </ul>
      </div>
      <div className={styles.hintActions}>
        <button type="button" className="fitx-button" onClick={() => onAnswer("add")}>Add to Home</button>
        <button type="button" className="fitx-button fitx-button-quiet" onClick={() => onAnswer("dismiss")}>Not now</button>
      </div>
    </section>
  );
}
