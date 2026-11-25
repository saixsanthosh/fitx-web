// Bug 3 (public-1, and the hotfix-2d leftover): Enter, or a press of the button, before the page's scripts had run made
// the browser submit the form itself, as GET /signin?, which reloaded the page, emptied the form and dropped ?next=. Each
// auth form now has a function `action` beside its onSubmit: React renders it with an action URL that can't navigate
// and sends its own inline script that holds a form submitted before hydration, then hands it to the action once the
// form is hydrated. The action presses the form's submit again, so the held press goes through onSubmit like any other
// (src/components/auth/early-submit.ts). Typed text is still kept by useKeepTypedValue (hotfix 2d).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resubmitWhenReady } from "@/components/auth/early-submit";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

/** The forms the server draws: each can be submitted before the page's scripts have run. */
const SERVER_DRAWN_FORMS = [
  "src/app/(auth)/signin/SignInForm.tsx",
  "src/app/(auth)/signup/SignUpForm.tsx",
  "src/app/(auth)/forgot-password/page.tsx",
  "src/app/(auth)/reset-password/page.tsx",
];

test("a held submission is pressed again once React's replay has returned, never during it", () => {
  const calls: string[] = [];
  const queued: Array<() => void> = [];
  const form = { requestSubmit: () => calls.push("requestSubmit") };
  resubmitWhenReady(form, (run) => queued.push(run));
  assert.deepEqual(calls, [], "not inside React's replay (a transition): the press waits for it to return");
  assert.equal(queued.length, 1);
  queued[0]();
  assert.deepEqual(calls, ["requestSubmit"], "then the form is submitted once, through its onSubmit");
});

test("with no form (unmounted) the replay does nothing", () => {
  const queued: Array<() => void> = [];
  resubmitWhenReady(null, (run) => queued.push(run));
  assert.equal(queued.length, 0);
});

test("by default the press waits for a microtask: after the replay, before anything else runs", async () => {
  let pressed = 0;
  resubmitWhenReady({ requestSubmit: () => { pressed += 1; } });
  assert.equal(pressed, 0);
  await Promise.resolve();
  assert.equal(pressed, 1);
});

// Review auth-r1: React's script holds every press made before hydration (a double tap, or Enter held down so it
// repeats), and React hands them all to the action in one task, one call each. Sent again one by one, each press reached
// onSubmit before React drew the first one's "busy", so `if (loading) return` let every one through.
test("the presses React replays together for a form are sent once", () => {
  const queued: Array<() => void> = [];
  let pressed = 0;
  const form = { requestSubmit: () => { pressed += 1; } };
  for (let press = 0; press < 3; press += 1) resubmitWhenReady(form, (run) => queued.push(run));
  assert.equal(queued.length, 1, "one press waits; the others join it");
  queued[0]();
  assert.equal(pressed, 1);
});

test("once the held presses are sent, a later one is a new submission, and each form waits on its own", () => {
  const queued: Array<() => void> = [];
  const later = (run: () => void) => queued.push(run);
  const sent: string[] = [];
  const signIn = { requestSubmit: () => sent.push("sign-in") };
  const other = { requestSubmit: () => sent.push("other") };
  resubmitWhenReady(signIn, later);
  resubmitWhenReady(other, later);
  assert.equal(queued.length, 2, "two forms, two waits");
  queued.shift()?.();
  resubmitWhenReady(signIn, later);
  assert.equal(queued.length, 2, "the sign-in form's wait was over: a new press queues again");
  while (queued.length) queued.shift()?.();
  assert.deepEqual(sent, ["sign-in", "other", "sign-in"]);
});

test("a double tap before the page was ready makes one request, though onSubmit's busy check sees the old state", async () => {
  // A stand-in for an auth form: onSubmit returns early while busy, but "busy" only shows once React draws it, in a
  // microtask that is queued behind presses already waiting (React's own scheduling).
  let drawnBusy = false;
  let requests = 0;
  const form = {
    requestSubmit() {
      if (drawnBusy) return;
      requests += 1;
      queueMicrotask(() => { drawnBusy = true; });
    },
  };
  // React's replay: the action runs once per held press, in one task.
  for (let press = 0; press < 2; press += 1) resubmitWhenReady(form);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests, 1, "one sign-in, not one per press");
});

test("every form the server draws has the replaying action beside an onSubmit that prevents the browser's own submit", () => {
  for (const file of SERVER_DRAWN_FORMS) {
    const text = read(file);
    const forms = text.match(/<form\b[^>]*>/g) ?? [];
    assert.equal(forms.length, 1, `${file}: one form`);
    assert.match(forms[0], /\bref=\{formRef\} action=\{replayEarlySubmit\} onSubmit=\{submit\}/, `${file}: ${forms[0]}`);
    assert.match(text, /const formRef = useRef<HTMLFormElement>\(null\);\s*const replayEarlySubmit = useEarlySubmit\(formRef\);/, file);
    // preventDefault first: React then never calls the action after hydration, and the replay's own press can't loop.
    assert.match(text, /function submit\(event: FormEvent<HTMLFormElement>\) \{\s*event\.preventDefault\(\);/, `${file}: submit prevents the browser's submit first`);
  }
});

test("no field of the sign-in pages has a name, so nothing typed can ever reach an address", () => {
  for (const file of [...SERVER_DRAWN_FORMS, "src/components/auth/EmailCodeStep.tsx", "src/components/auth/CodeField.tsx"]) {
    for (const input of read(file).match(/<input\b[\s\S]*?\/>/g) ?? []) assert.doesNotMatch(input, /\bname=/, `${file}: ${input.slice(0, 80)}`);
  }
});

test("the code step's form is only ever drawn by React, after a code is sent, so it needs no replay", () => {
  for (const file of ["src/app/(auth)/signin/SignInForm.tsx", "src/app/(auth)/signup/SignUpForm.tsx"]) {
    assert.match(read(file), /\? \(\s*<m\.div key="code" className=\{s\.body\} \{\.\.\.slide\}>\s*<EmailCodeStep flow=\{codeFlow\} \/>/, file);
  }
  assert.match(read("src/components/auth/useEmailCode.ts"), /useState<"email" \| "code">\("email"\)/, "the flow starts on the email step");
});

test("the React that Next ships renders a function action as a URL that can't navigate and replays forms held before hydration", () => {
  const compiled = "node_modules/next/dist/compiled/react-dom/cjs";
  for (const server of ["react-dom-server.node.production.js", "react-dom-server.edge.production.js"]) {
    const text = read(`${compiled}/${server}`);
    assert.ok(text.includes("javascript:throw new Error('React form unexpectedly submitted.')"), `${server}: the action URL`);
    assert.ok(text.includes("$$reactFormReplay"), `${server}: the inline script that holds an early submission`);
  }
  assert.ok(read(`${compiled}/react-dom-client.production.js`).includes("$$reactFormReplay"), "the client replays what the script held");
});
