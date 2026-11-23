"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import { useReducedMotionSafe } from "@/components/motion";
import type { LandingContact } from "./contact";
import styles from "./landing.module.css";

/** A card that leans toward the pointer, with a soft highlight where the light would catch it. Still with reduced motion. */
function Tilt({ children, className }: { children: ReactNode; className: string }) {
  const reduced = useReducedMotionSafe();
  const ref = useRef<HTMLDivElement>(null);
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = ref.current;
    if (!element || reduced || event.pointerType !== "mouse") return;
    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    element.style.setProperty("--rx", `${((0.5 - y) * 9).toFixed(2)}deg`);
    element.style.setProperty("--ry", `${((x - 0.5) * 11).toFixed(2)}deg`);
    element.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    element.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
  };
  const leave = () => {
    const element = ref.current;
    if (!element) return;
    for (const name of ["--rx", "--ry", "--mx", "--my"]) element.style.removeProperty(name);
  };
  return (
    <div ref={ref} className={className} onPointerMove={move} onPointerLeave={leave}>
      {children}
    </div>
  );
}

/**
 * The owner's Instagram and email as two objects rather than two lines: a profile card with a turning story ring
 * that leans toward the pointer, and an envelope whose flap lifts to show the address. Each part shows only when its
 * setting is filled (contact.ts); nothing is invented.
 */
export function ContactBlock({ contact }: { contact: LandingContact }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  if (!contact.instagram && !contact.email) return null;

  const copy = async () => {
    if (!contact.email) return;
    try {
      await navigator.clipboard.writeText(contact.email);
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className={styles.contact} aria-labelledby="contact-title">
      <div className={styles.contactHead}>
        <p className={styles.eyebrow}>Contact</p>
        <h2 id="contact-title" className={styles.contactTitle}>Say hello.</h2>
      </div>
      <div className={styles.contactGrid}>
        {contact.instagram && (
          <Tilt className={styles.cardWrap}>
            <a href={contact.instagram.url} target="_blank" rel="noopener noreferrer" className={styles.igCard} aria-label={`Instagram @${contact.instagram.handle} (opens in a new tab)`}>
              <span className={styles.cardSheen} aria-hidden="true" />
              <span className={styles.igTop} aria-hidden="true">
                <span className={styles.igRing}>
                  <Image src="/images/instagram-profile.png" alt="" width={84} height={84} sizes="84px" className={styles.igPortrait} />
                </span>
                <span className={styles.igKind}>Instagram</span>
              </span>
              <span className={styles.igHandle} aria-hidden="true">@{contact.instagram.handle}</span>
              <span className={styles.igFollow} aria-hidden="true">Follow <ArrowUpRight size={16} /></span>
            </a>
          </Tilt>
        )}
        {contact.email && (
          <div className={styles.mailWrap}>
            <Tilt className={styles.cardWrap}>
              <a href={`mailto:${contact.email}`} className={styles.mailCard} aria-label={`Email ${contact.email}`}>
                <span className={styles.cardSheen} aria-hidden="true" />
                <span className={styles.mailTop} aria-hidden="true">
                  <span className={styles.letterKind}>{/@gmail\.com$/i.test(contact.email) ? "Gmail" : "Email"}</span>
                  <span className={styles.envelope}>
                    <span className={styles.envelopeBack} />
                    <span className={styles.letter}><i /><i /><i /></span>
                    <span className={styles.envelopeFront} />
                    <span className={styles.flap} />
                  </span>
                </span>
                <span className={styles.mailAddress} aria-hidden="true">{contact.email}</span>
                <span className={styles.mailCta} aria-hidden="true">Write to us <ArrowUpRight size={16} /></span>
              </a>
            </Tilt>
            <button type="button" className={styles.copy} onClick={copy} aria-label={copied ? "Email address copied" : "Copy email address"}>
              {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              <span aria-hidden="true">{copied ? "Copied" : "Copy address"}</span>
            </button>
            <span className={styles.srOnly} aria-live="polite">{copied ? "Email address copied" : ""}</span>
          </div>
        )}
      </div>
    </section>
  );
}
