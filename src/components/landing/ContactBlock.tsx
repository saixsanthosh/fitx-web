"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import type { LandingContact } from "./contact";
import styles from "./landing.module.css";

/** Big type whose letters roll up on hover or focus (two stacked copies per letter; read once by screen readers). */
function Roll({ text }: { text: string }) {
  return (
    <span className={styles.roll} aria-hidden="true">
      {Array.from(text).map((char, index) => (
        <span key={index} className={styles.char} style={{ "--i": index } as CSSProperties}>
          <span><span>{char}</span><span>{char}</span></span>
        </span>
      ))}
    </span>
  );
}

/**
 * The owner's Instagram and e-mail as the last thing on the page: oversized rows that fill with the ember colour
 * and roll their letters on hover. Each part shows only when its setting is filled (see contact.ts).
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
        <div>
          <p className={styles.eyebrow}>Contact</p>
          <h2 id="contact-title" className={styles.contactTitle}>Say hello.</h2>
        </div>
      </div>
      <ul className={styles.contactList}>
        {contact.instagram && (
          <li className={styles.contactItem}>
            <a href={contact.instagram.url} target="_blank" rel="noopener noreferrer" className={styles.contactLink} aria-label={`Instagram @${contact.instagram.handle} (opens in a new tab)`}>
              <span className={styles.contactFill} aria-hidden="true" />
              <span className={styles.contactKind} aria-hidden="true">
                <Image src="/images/instagram-profile.png" alt="" width={28} height={28} sizes="28px" className={styles.portrait} />
                Instagram
              </span>
              <span className={styles.contactValue}><Roll text={`@${contact.instagram.handle}`} /></span>
              <span className={styles.contactArrow} aria-hidden="true"><ArrowUpRight size={22} /></span>
            </a>
          </li>
        )}
        {contact.email && (
          <li className={styles.contactItem}>
            <a href={`mailto:${contact.email}`} className={styles.contactLink} aria-label={`Email ${contact.email}`}>
              <span className={styles.contactFill} aria-hidden="true" />
              <span className={styles.contactKind} aria-hidden="true">{/@gmail\.com$/i.test(contact.email) ? "Gmail" : "Email"}</span>
              <span className={styles.contactValue}><Roll text={contact.email} /></span>
              <span className={styles.contactArrow} aria-hidden="true"><ArrowUpRight size={22} /></span>
            </a>
            <button type="button" className={styles.copy} onClick={copy} aria-label={copied ? "Email address copied" : "Copy email address"}>
              {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              <span aria-hidden="true">{copied ? "Copied" : "Copy"}</span>
            </button>
            <span className={styles.srOnly} aria-live="polite">{copied ? "Email address copied" : ""}</span>
          </li>
        )}
      </ul>
    </section>
  );
}
