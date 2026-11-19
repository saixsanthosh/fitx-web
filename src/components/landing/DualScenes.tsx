"use client";

import Image from "next/image";
import { useCallback, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { AnimatePresence, m, useTransform, type MotionValue } from "framer-motion";
import { ScrollScene } from "@/components/motion";
import { LANDING_MEDIA, type LandingMediaId } from "@/data/landing-media";
import {
  EXAMPLE_PLAN, POSE_FRAME, bonesPath, cueAt, frameAt, jointsPath, kneeAngle, kneeArcPath, manFrameAt, planDoneAt, poseAt, repsAt, squatDepth,
} from "./story";
import styles from "./landing.module.css";

const PANEL_SIZES = "(max-width: 767px) 100vw, (max-width: 1280px) 50vw, 620px";

/** Discrete values (rep count, cue, plan rows) that follow the scroll, re-rendering only when they change. */
function useStep<T extends string | number>(progress: MotionValue<number>, read: (p: number) => T): T {
  const subscribe = useCallback((onChange: () => void) => progress.on("change", onChange), [progress]);
  // The server (and hydration) draw the top of the scene, as the server-rendered motion values do.
  return useSyncExternalStore(subscribe, () => read(progress.get()), () => read(0));
}

/**
 * The centrepiece: a man reading the day's plan on his phone beside a woman whose phone is set aside while the
 * form check reads her squat. Side by side from 768 px, stacked on phones; scroll drives both. Reduced motion:
 * one still frame, the plan done and the squat at depth.
 */
export function DualScenes() {
  return (
    <ScrollScene id="scenes" label="Two ways to train" length={3.2} className={styles.scenes} stageClassName={styles.sceneStage}>
      {(progress) => <Stage progress={progress} />}
    </ScrollScene>
  );
}

function Stage({ progress }: { progress: MotionValue<number> }) {
  return (
    <>
      <div className={styles.sceneHead}>
        <div>
          <p className={`${styles.eyebrow} ${styles.stageEyebrow}`}>Gym · Home</p>
          <h2 className={styles.sceneTitle}>Two ways to train.</h2>
        </div>
        <span className={styles.sceneMeter} aria-hidden="true"><m.span style={{ scaleX: progress }} /></span>
      </div>
      <div className={styles.panels}>
        <PlanPanel progress={progress} />
        <FormPanel progress={progress} />
      </div>
    </>
  );
}

function Frame({ id, visible, describe }: { id: LandingMediaId; visible: MotionValue<number>; describe: boolean }) {
  const image = LANDING_MEDIA[id];
  return (
    <m.div className={styles.panelPhoto} style={{ opacity: visible, transition: "opacity 140ms linear" }}>
      <Image src={image.src} alt={describe ? image.alt : ""} fill sizes={PANEL_SIZES} placeholder="blur" blurDataURL={image.blurDataURL} />
    </m.div>
  );
}

const readPlanDone = (p: number) => planDoneAt(p);

function PlanPanel({ progress }: { progress: MotionValue<number> }) {
  const reading = useTransform<number, number>(progress, (p) => (manFrameAt(p) === 0 ? 1 : 0));
  const lifting = useTransform<number, number>(progress, (p) => (manFrameAt(p) === 1 ? 1 : 0));
  const push = useTransform(progress, [0, 1], [1, 1.06]);
  const cardY = useTransform(progress, [0.02, 0.16], [28, 0], { clamp: true });
  const cardOpacity = useTransform(progress, [0.02, 0.12], [0, 1], { clamp: true });
  const done = useStep(progress, readPlanDone);
  return (
    <article className={styles.panel} aria-labelledby="scene-plan-title">
      <m.div className={`${styles.canvas} ${styles.manCanvas}`} style={{ scale: push }}>
        <Frame id="man-plan" visible={reading} describe />
        <Frame id="man-lift" visible={lifting} describe={false} />
      </m.div>
      <div className={styles.panelShade} aria-hidden="true" />
      <div className={styles.panelLabel}>
        <h3 id="scene-plan-title">Gym plan</h3>
        <p>Today&apos;s session, set by FITX</p>
      </div>
      <m.div className={styles.planCard} style={{ y: cardY, opacity: cardOpacity }} aria-label="Example plan in FITX" role="group">
        <div className={styles.planTop}>
          <strong>Push · Today</strong>
          <span className={styles.planTag}>Example</span>
        </div>
        <div className={styles.planBar} aria-hidden="true">
          <span style={{ transform: `scaleX(${done / EXAMPLE_PLAN.length})`, transition: "transform 320ms cubic-bezier(.22,1,.36,1)" }} />
        </div>
        <ol className={styles.planList}>
          {EXAMPLE_PLAN.map((row, index) => (
            <li key={row.name} className={styles.planRow} data-done={index < done} data-current={index === done}>
              <span className={styles.planCheck} aria-hidden="true"><Check size={10} strokeWidth={3} /></span>
              <span>{row.name}</span>
              <small>{row.detail}</small>
            </li>
          ))}
        </ol>
      </m.div>
    </article>
  );
}

const readReps = (p: number) => repsAt(p);
const readCue = (p: number) => cueAt(p);

function FormPanel({ progress }: { progress: MotionValue<number> }) {
  const frame = useTransform<number, number>(progress, (p) => frameAt(squatDepth(p)));
  const stand = useTransform<number, number>(frame, (f) => (f === 0 ? 1 : 0));
  const mid = useTransform<number, number>(frame, (f) => (f === 1 ? 1 : 0));
  const bottom = useTransform<number, number>(frame, (f) => (f === 2 ? 1 : 0));
  const pose = useTransform(progress, (p) => poseAt(squatDepth(p)));
  const bones = useTransform(pose, (value) => bonesPath(value));
  const joints = useTransform(pose, (value) => jointsPath(value));
  const arc = useTransform(pose, (value) => kneeArcPath(value));
  const angle = useTransform(pose, (value) => `Knee ${kneeAngle(value)}°`);
  const angleX = useTransform(pose, (value) => value.knee[0] + 64);
  const angleY = useTransform(pose, (value) => value.knee[1] + 96);
  const draw = useTransform(progress, [0, 0.1], [0.001, 1], { clamp: true });
  const push = useTransform(progress, [0, 1], [1, 1.05]);
  const reps = useStep(progress, readReps);
  const cue = useStep(progress, readCue);

  return (
    <article className={styles.panel} aria-labelledby="scene-form-title" aria-describedby="scene-form-note">
      <m.div className={`${styles.canvas} ${styles.womanCanvas}`} style={{ scale: push }}>
        <Frame id="woman-stand" visible={stand} describe />
        <Frame id="woman-mid" visible={mid} describe={false} />
        <Frame id="woman-squat" visible={bottom} describe={false} />
        <svg className={styles.poseLayer} viewBox={`0 0 ${POSE_FRAME.width} ${POSE_FRAME.height}`} preserveAspectRatio="none" aria-hidden="true">
          <m.path className={styles.boneHalo} d={bones} style={{ pathLength: draw }} />
          <m.path className={styles.bone} d={bones} style={{ pathLength: draw }} />
          <m.path className={styles.kneeArc} d={arc} style={{ opacity: draw }} />
          <m.path className={styles.joints} d={joints} style={{ opacity: draw }} />
          <m.text className={styles.angleText} x={angleX} y={angleY} style={{ opacity: draw }}>{angle}</m.text>
        </svg>
      </m.div>
      <div className={styles.panelShade} aria-hidden="true" />
      <div className={styles.panelLabel}>
        <h3 id="scene-form-title">Home workout</h3>
        <p>Phone down. FITX reads the rep.</p>
      </div>
      <p id="scene-form-note" className={styles.srOnly}>
        The camera tracks her joints, draws them over the picture, counts each squat and speaks short cues, shown as captions.
      </p>
      <span className={styles.liveTag} aria-hidden="true"><i className={styles.liveDot} />Form check</span>
      <div className={styles.reps} aria-hidden="true"><strong data-scene-reps="">{reps}</strong><span>Reps</span></div>
      <span className={styles.phoneTag} aria-hidden="true">Phone set aside</span>
      <div className={styles.caption} aria-hidden="true">
        <span key={cue} className={styles.voice} data-speaking="true"><i /><i /><i /><i /></span>
        {/* Presence's props type has no children (reported); same defaults here. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <m.span key={cue} data-scene-cue="" className={styles.captionText} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
            {cue}
          </m.span>
        </AnimatePresence>
      </div>
    </article>
  );
}
