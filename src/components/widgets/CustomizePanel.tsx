"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { Reorder, useDragControls, useReducedMotion } from "framer-motion";
import { BicepsFlexed, CalendarCheck2, CalendarDays, ChevronDown, ChevronUp, Compass, Droplets, EyeOff, GripVertical, Plus, Scale, Utensils } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { WIDGETS, describePosition, hiddenIds, visibleIds, type LayoutAction, type LayoutItem, type WidgetId } from "@/lib/domain/dashboard-layout";
import type { SaveState } from "./useHomeData";
import styles from "./Widgets.module.css";

export const WIDGET_ICONS: Record<WidgetId, typeof Scale> = {
  plan: CalendarCheck2, next: Compass, muscles: BicepsFlexed, weight: Scale, water: Droplets, week: CalendarDays, macros: Utensils,
};

/** Customise Home: drag or use the arrows to order widgets, hide them, or add hidden ones back. */
export function CustomizePanel({ open, onClose, items, dispatch, save, canSave, loadError, onRetrySave }: {
  open: boolean;
  onClose: () => void;
  items: LayoutItem[];
  dispatch: (action: LayoutAction) => void;
  save: SaveState;
  canSave: boolean;
  loadError: string;
  onRetrySave: () => void;
}) {
  const shown = visibleIds(items);
  const hidden = hiddenIds(items);
  const [announcement, setAnnouncement] = useState("");
  const reduceMotion = useReducedMotion();

  function act(action: LayoutAction, message: string) {
    dispatch(action);
    setAnnouncement(message);
  }

  const status = !canSave || save === "unavailable"
    ? loadError || "Can't save here yet. Changes last until you leave."
    : save === "saving" ? "Saving…" : save === "saved" ? "Saved" : save === "error" ? "Couldn't save your arrangement." : "";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Customise Home"
      footer={<>
        <button type="button" className={`fitx-button fitx-button-quiet ${styles.resetButton}`} onClick={() => { dispatch({ type: "reset" }); setAnnouncement("Home reset to the default widgets"); }}>Reset</button>
        <p className={styles.saveStatus} role="status">
          {status}
          {save === "error" && canSave && <button type="button" className={styles.noteLink} onClick={onRetrySave}>Try again</button>}
        </p>
        <button type="button" className="fitx-button" onClick={onClose}>Done</button>
      </>}
    >
      <h3 className={styles.panelHeading}>Shown</h3>
      {shown.length ? (
        <Reorder.Group as="ol" axis="y" values={shown} onReorder={(order: WidgetId[]) => dispatch({ type: "reorder", order })} className={styles.panelList}>
          {shown.map((id, index) => (
            <CustomizeRow
              key={id}
              id={id}
              index={index}
              count={shown.length}
              reduceMotion={Boolean(reduceMotion)}
              onMove={(delta) => {
                const to = Math.max(0, Math.min(shown.length - 1, index + delta));
                act({ type: "move", id, delta }, `${WIDGETS[id].title}, position ${to + 1} of ${shown.length}`);
              }}
              onHide={() => act({ type: "hide", id }, `${WIDGETS[id].title} hidden`)}
              onDragEnd={() => setAnnouncement(describePosition(items, id))}
            />
          ))}
        </Reorder.Group>
      ) : (
        <p className={styles.panelEmpty}>No widgets shown</p>
      )}

      <h3 className={styles.panelHeading}>Add</h3>
      {hidden.length ? (
        <ul className={styles.panelList}>
          {hidden.map((id) => {
            const Icon = WIDGET_ICONS[id];
            return (
              <li key={id} className={`${styles.panelRow} ${styles.panelRowHidden}`}>
                <span className={styles.panelIcon} aria-hidden="true"><Icon size={17} /></span>
                <span className={styles.panelText}><strong>{WIDGETS[id].title}</strong><small>{WIDGETS[id].description}</small></span>
                <button type="button" className={styles.panelAdd} onClick={() => act({ type: "show", id }, `${WIDGETS[id].title} added to Home`)} aria-label={`Add ${WIDGETS[id].title} to Home`}>
                  <Plus size={16} aria-hidden="true" />Add
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.panelEmpty}>All widgets shown</p>
      )}
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </Sheet>
  );
}

function CustomizeRow({ id, index, count, reduceMotion, onMove, onHide, onDragEnd }: {
  id: WidgetId;
  index: number;
  count: number;
  reduceMotion: boolean;
  onMove: (delta: number) => void;
  onHide: () => void;
  onDragEnd: () => void;
}) {
  const controls = useDragControls();
  const Icon = WIDGET_ICONS[id];
  const name = WIDGETS[id].title;
  function onKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      onMove(event.key === "ArrowUp" ? -1 : 1);
    }
  }
  return (
    <Reorder.Item as="li" value={id} dragListener={false} dragControls={controls} onDragEnd={onDragEnd} className={styles.panelRow} transition={reduceMotion ? { duration: 0 } : undefined}>
      <button type="button" className={styles.panelHandle} aria-label={`Reorder ${name}. Use the up and down arrow keys.`} onPointerDown={(event: PointerEvent<HTMLButtonElement>) => controls.start(event)} onKeyDown={onKey}>
        <GripVertical size={16} aria-hidden="true" />
      </button>
      <span className={styles.panelIcon} aria-hidden="true"><Icon size={17} /></span>
      <span className={styles.panelText}><strong>{name}</strong><small>{WIDGETS[id].description}</small></span>
      <span className={styles.panelButtons}>
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${name} up`}><ChevronUp size={17} aria-hidden="true" /></button>
        <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move ${name} down`}><ChevronDown size={17} aria-hidden="true" /></button>
        <button type="button" onClick={onHide} aria-label={`Hide ${name}`}><EyeOff size={16} aria-hidden="true" /></button>
      </span>
    </Reorder.Item>
  );
}
