// The floating AI Coach contract (BRIEF 3.2): event names, the open handshake and the panel's accessible names.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COACH_CLOSE_EVENT, COACH_OPEN_EVENT, MAX_OPEN_PROMPT, openPrompt, requestCoachOpen } from "../../src/components/coach/coach-events.ts";

const source = (file: string) => readFileSync(new URL(`../../src/components/coach/${file}`, import.meta.url), "utf8");

describe("coach events", () => {
  test("the literal event names other streams rely on", () => {
    assert.equal(COACH_OPEN_EVENT, "fitx:coach-open");
    assert.equal(COACH_CLOSE_EVENT, "fitx:coach-close");
  });

  test("requestCoachOpen reports whether a host took the event", () => {
    const target = new EventTarget();
    assert.equal(requestCoachOpen({ source: "test" }, target), false, "nobody listening: the caller navigates");
    let seen: unknown = null;
    target.addEventListener(COACH_OPEN_EVENT, (event) => {
      seen = (event as CustomEvent).detail;
      event.preventDefault();
    });
    assert.equal(requestCoachOpen({ source: "activity", prompt: "Hi" }, target), true);
    assert.deepEqual(seen, { source: "activity", prompt: "Hi" });
  });

  test("open prompts are trimmed, collapsed and capped", () => {
    assert.equal(openPrompt({ source: "x", prompt: "  How   was my run?  " }), "How was my run?");
    assert.equal(openPrompt({ source: "x", prompt: "   " }), undefined);
    assert.equal(openPrompt({ source: "x", prompt: 4 }), undefined);
    assert.equal(openPrompt(null), undefined);
    assert.equal(openPrompt({ source: "x", prompt: "a".repeat(2000) })?.length, MAX_OPEN_PROMPT);
  });
});

describe("coach panel", () => {
  test("is a modal dialog named AI Coach with Close AI Coach, closed through the parent", () => {
    const panel = source("CoachPanel.tsx");
    assert.match(panel, /aria-labelledby="coach-panel-title"/);
    assert.match(panel, /id="coach-panel-title"[^>]*>AI Coach</);
    assert.match(panel, /aria-label="Close AI Coach"/);
    assert.match(panel, /element\.showModal\(\)/, "a native modal dialog traps focus and makes the page inert");
    assert.match(panel, /onCancel=\{\(event\) => \{\s*event\.preventDefault\(\);\s*onClose\(\);/, "Escape runs the same close path");
    assert.match(panel, /prefers-reduced-motion: reduce/);
  });

  test("the host takes the open event, lazy-loads the panel and announces the close", () => {
    const host = source("CoachPanelHost.tsx");
    assert.match(host, /lazy\(\(\) => import\("\.\/CoachPanel"\)/);
    assert.match(host, /event\.preventDefault\(\)/);
    assert.match(host, /window\.dispatchEvent\(new CustomEvent\(COACH_CLOSE_EVENT\)\)/);
    assert.match(host, /export function CoachPanelHost\(\)/);
  });

  test("a bottom sheet below 768 px and a side panel from 768 px", () => {
    const css = source("CoachPanel.module.css");
    assert.match(css, /@media \(min-width: 768px\) \{\s*\.panel \{ inset: 0 0 0 auto;/);
    assert.match(css, /@keyframes sheet-in \{ from \{ transform: translateY\(100%\)/);
  });
});
