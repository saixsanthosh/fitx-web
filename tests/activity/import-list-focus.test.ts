// Release 3 fix round 3f (round 3e's open items, D5): on /activity/import, controls of the file list went while they
// had focus, and focus fell to the page. A file's Remove went with its card, Clear list with the whole list, and Check
// again with its alert, which was hidden while it checked, so focus fell to the page even when the check failed again.
// One ref now sees which control went with focus (importFocusWitness), and once that draw is done focus moves on to
// what is left in its place (importFocusAfter): after Remove, the next file's Remove, else the one before it, else
// Choose files; after Clear list, Choose files. Check again keeps its alert while it checks (aria-disabled), so it
// keeps focus, also when the check fails again; once a check works, the Import button, else the files' heading. Only
// while the page has focus: focus the member moved stays where it is.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusDropped, type FocusDocument } from "@/lib/activity/focus";
import { canRemove, focusAfterRemove, importControlOf, importFocusAfter, importFocusWitness, type ListedFile } from "@/lib/activity/import/focus";

const read = (file: string) => readFileSync(file, "utf8");
const files = (...keys: string[]): ListedFile[] => keys.map((key) => ({ key, removable: true }));
const done = (key: string): ListedFile => ({ key, removable: false });

/** A page that nothing has focused yet, and the file list's controls on it. */
function page() {
  const body = { name: "the page" };
  const doc: FocusDocument = { activeElement: body, body };
  const control = (dataset: { importControl?: string; importFile?: string }) => ({ ownerDocument: doc, isConnected: true, dataset });
  /**
   * What React does when it takes a control out of the page (its card, the list or the alert goes): the control's ref
   * is taken away (its cleanup runs) while it is still on the page, then it leaves, and focus that was on it falls to
   * the page.
   */
  const takeOut = (element: ReturnType<typeof control>, cleanup: (() => void) | undefined) => {
    cleanup?.();
    element.isConnected = false;
    if (doc.activeElement === element) doc.activeElement = body;
  };
  return { doc, control, takeOut };
}

describe("where focus goes once a control of the file list went with it", () => {
  test("a file's Remove: the next file's Remove, else the one before it, else Choose files", () => {
    assert.deepEqual(focusAfterRemove(files("a", "b", "c"), "b", files("a", "c")), { remove: "c" }, "the next file moves up into its place");
    assert.deepEqual(focusAfterRemove(files("a", "b", "c"), "a", files("b", "c")), { remove: "b" });
    assert.deepEqual(focusAfterRemove(files("a", "b", "c"), "c", files("a", "b")), { remove: "b" }, "the last file: the one before it");
    assert.equal(focusAfterRemove(files("a"), "a", []), "choose", "none left: the list went with it");
  });

  test("files without a Remove (imported, or with their result) are passed over; none with one left: Choose files", () => {
    // After an import the files that have their result show "Imported" and Open activity, not Remove.
    assert.deepEqual(focusAfterRemove([...files("a"), done("b"), ...files("c")], "a", [done("b"), ...files("c")]), { remove: "c" });
    assert.deepEqual(focusAfterRemove([...files("a"), done("b"), ...files("c")], "c", [...files("a"), done("b")]), { remove: "a" });
    assert.equal(focusAfterRemove([done("a"), ...files("b")], "b", [done("a")]), "choose");
    // A key that wasn't drawn says nothing about its place: Choose files.
    assert.equal(focusAfterRemove(files("a", "b"), "x", files("a", "b")), "choose");
  });

  test("Clear list: Choose files, to choose others", () => {
    assert.equal(importFocusAfter({ control: "clear" }, { before: files("a", "b"), after: [], importReady: false }), "choose");
    // Clear list also goes while the files are imported (it comes back after): Choose files all the same.
    assert.equal(importFocusAfter({ control: "clear" }, { before: files("a"), after: [done("a")], importReady: false }), "choose");
    assert.deepEqual(importFocusAfter({ control: "remove", file: "a" }, { before: files("a", "b"), after: files("b"), importReady: true }), { remove: "b" }, "Remove: focusAfterRemove");
  });

  test("Check again once the check worked: the Import button when it has something to import, else the files' heading; no files left: Choose files", () => {
    const list = files("a", "b");
    assert.equal(importFocusAfter({ control: "check" }, { before: list, after: list, importReady: true }), "import", "“Import 2 activities”: the next step");
    // Nothing to import yet (every file already in FITX, or a sport still to choose): the cards below the heading say why.
    assert.equal(importFocusAfter({ control: "check" }, { before: list, after: list, importReady: false }), "files");
    // No files left (Clear list clicked without moving focus, as Safari's clicks do, while focus was on Check again).
    assert.equal(importFocusAfter({ control: "check" }, { before: list, after: [], importReady: false }), "choose");
  });

  test("the Remove a card shows: for a file being read, ready, or one that can't be imported; never while importing, nor once it has its result", () => {
    for (const phase of ["reading", "ready", "unsupported", "failed"] as const) {
      assert.equal(canRemove(phase, false), true, phase);
      assert.equal(canRemove(phase, true), false, `${phase}, while the files are imported`);
    }
    assert.equal(canRemove("importing", false), false);
    assert.equal(canRemove("done", false), false);
  });
});

describe("the witness", () => {
  test("a control that goes with focus is told once, with what it is", () => {
    const { doc, control, takeOut } = page();
    const witness = importFocusWitness();
    const remove = control({ importControl: "remove", importFile: "file-2" });
    const cleanup = witness.ref(remove);
    doc.activeElement = remove;
    takeOut(remove, cleanup);
    assert.equal(focusDropped(doc), true, "the browser dropped focus to the page");
    assert.deepEqual(witness.take(), { control: "remove", file: "file-2" });
    assert.equal(witness.take(), null, "said once, then forgotten");
    const clear = control({ importControl: "clear" });
    const clearCleanup = witness.ref(clear);
    doc.activeElement = clear;
    takeOut(clear, clearCleanup);
    assert.deepEqual(witness.take(), { control: "clear" });
  });

  test("nothing for a control that went without focus, one still on the page, or one that isn't the list's", () => {
    const { doc, control, takeOut } = page();
    const witness = importFocusWitness();
    // A click that doesn't focus the button (Safari): Remove went, but focus wasn't on it, so nothing moves.
    const remove = control({ importControl: "remove", importFile: "file-1" });
    takeOut(remove, witness.ref(remove));
    assert.equal(witness.take(), null);
    // Focus on another control (the next file's Remove) as one goes: it stays there.
    const other = control({ importControl: "remove", importFile: "file-3" });
    const gone = control({ importControl: "remove", importFile: "file-2" });
    const goneCleanup = witness.ref(gone);
    doc.activeElement = other;
    takeOut(gone, goneCleanup);
    assert.equal(witness.take(), null);
    // Its ref only taken away and given again (React's second attach in development): still on the page, says nothing.
    const kept = control({ importControl: "clear" });
    doc.activeElement = kept;
    witness.ref(kept)?.();
    witness.ref(kept);
    assert.equal(witness.take(), null);
    // A Remove without its file, or something else entirely, isn't one of the list's controls.
    assert.equal(importControlOf({ importControl: "remove" }), null);
    assert.equal(importControlOf({ importControl: "older" }), null);
    assert.equal(importControlOf({}), null);
    assert.equal(witness.ref(null), undefined, "nothing to clean up for no control");
  });
});

describe("the whole hand-off, as the screen does it", () => {
  test("Remove of the second of three files: its card goes and the third file's Remove takes focus", () => {
    const { doc, control, takeOut } = page();
    const witness = importFocusWitness();
    const before = files("file-1", "file-2", "file-3");
    const buttons = new Map(before.map((file) => [file.key, control({ importControl: "remove", importFile: file.key })]));
    const cleanups = new Map([...buttons].map(([key, button]) => [key, witness.ref(button)]));
    doc.activeElement = buttons.get("file-2");
    // Enter on "Remove <name>": the list is drawn without it.
    takeOut(buttons.get("file-2")!, cleanups.get("file-2"));
    const went = witness.take();
    assert.ok(went && focusDropped(doc));
    assert.deepEqual(importFocusAfter(went, { before, after: files("file-1", "file-3"), importReady: true }), { remove: "file-3" });
  });

  test("Clear list: the list goes with it and Choose files takes focus", () => {
    const { doc, control, takeOut } = page();
    const witness = importFocusWitness();
    const clear = control({ importControl: "clear" });
    const removes = ["file-1", "file-2"].map((key) => control({ importControl: "remove", importFile: key }));
    const cleanups = [clear, ...removes].map((element) => witness.ref(element));
    doc.activeElement = clear;
    // The whole list goes: every control's ref is taken away, only Clear list had focus.
    [clear, ...removes].forEach((element, index) => takeOut(element, cleanups[index]));
    const went = witness.take();
    assert.deepEqual(went, { control: "clear" });
    assert.ok(focusDropped(doc));
    assert.equal(importFocusAfter(went!, { before: files("file-1", "file-2"), after: [], importReady: false }), "choose");
  });

  test("Check again: its alert stays while it checks and when the check fails again, so focus stays; once one works, Import takes it", () => {
    const { doc, control, takeOut } = page();
    const witness = importFocusWitness();
    const checkAgain = control({ importControl: "check" });
    const cleanup = witness.ref(checkAgain);
    doc.activeElement = checkAgain;
    // Enter: "Checking…" (aria-disabled), the alert and its button stay. The check fails again: still there.
    assert.equal(witness.take(), null, "nothing went");
    assert.equal(doc.activeElement, checkAgain, "focus stays on Check again");
    // Enter again, and this time the account is read: the alert goes with Check again.
    takeOut(checkAgain, cleanup);
    const went = witness.take();
    assert.deepEqual(went, { control: "check" });
    assert.ok(focusDropped(doc));
    assert.equal(importFocusAfter(went!, { before: files("file-1", "file-2"), after: files("file-1", "file-2"), importReady: true }), "import");
  });
});

describe("Check again (the screen)", () => {
  const screen = read("src/components/activity/ActivityImportScreen.tsx");

  test("the alert stays while it checks, with its message drawn anew after each failure, so a failure again is read out again", () => {
    assert.doesNotMatch(screen, /lookupFailed && !reading/, "no longer hidden while it checks");
    assert.match(screen, /\{lookupFailed && \(\s+<div className="fitx-alert fitx-alert-danger flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">\s+<p key=\{lookupFailures\} role="alert">FITX couldn’t check your activities for these sessions, so nothing can be imported yet\. Check your connection and try again\.<\/p>/);
    // Every failed check is counted, from Check again and from files chosen after a failure.
    assert.equal((screen.match(/setLookupFailed\(!ok\);\s+if \(!ok\) setLookupFailures\(\(count\) => count \+ 1\);\s+setReading\(false\);/g) ?? []).length, 2);
    assert.match(screen, /const \[lookupFailures, setLookupFailures\] = useState\(0\);/);
  });

  test("Check again says aria-disabled and “Checking…” while it checks, a press meanwhile does nothing, and it is witnessed", () => {
    assert.match(screen, /<button type="button" ref=\{controlRef\} data-import-control="check" onClick=\{\(\) => void checkAgain\(\)\} aria-disabled=\{reading \|\| importing \|\| undefined\} className="[^"]*aria-disabled:cursor-progress aria-disabled:opacity-60">\s+\{reading \? <><LoaderCircle size=\{17\} aria-hidden="true" className="animate-spin" \/>Checking…<\/> : "Check again"\}/);
    assert.match(screen, /async function checkAgain\(\) \{\s+\/\/[^\n]*\n\s+if \(reading \|\| importing\) return;\s+setReading\(true\);/);
    assert.doesNotMatch(screen, /(?<!aria-)disabled=\{reading/);
  });
});

describe("the screen's wiring", () => {
  const screen = read("src/components/activity/ActivityImportScreen.tsx");

  test("one witness for the list's controls, and one hand-off once a draw took one of them with focus", () => {
    assert.match(screen, /const \[\{ ref: controlRef, take: controlWent \}\] = useState\(\(\) => importFocusWitness<HTMLElement>\(\)\);/);
    assert.match(screen, /const listed: ListedFile\[\] = entries\.map\(\(entry\) => \(\{ key: entry\.key, removable: canRemove\(entry\.phase, importing\) \}\)\);/);
    assert.match(screen, /useEffect\(\(\) => \{\s+const before = drawnFiles\.current;\s+drawnFiles\.current = listed;\s+const went = controlWent\(\);\s+if \(!went \|\| !focusDropped\(document\)\) return;\s+const target = importFocusAfter\(went, \{ before, after: listed, importReady \}\);\s+if \(target === "choose"\) chooseRef\.current\?\.focus\(\);\s+else if \(target === "import"\) importButtonRef\.current\?\.focus\(\);\s+else if \(target === "files"\) filesTitleRef\.current\?\.focus\(\);\s+else removeButton\(listRef\.current, target\.remove\)\?\.focus\(\);\s+\}\);/);
    // The hooks come before the screen's early returns (signed out, loading, …).
    const early = screen.indexOf('if (account.status === "loading")');
    for (const hook of ["importFocusWitness<HTMLElement>()", "const drawnFiles = useRef", "drawnFiles.current = listed;"]) assert.ok(screen.indexOf(hook) > 0 && screen.indexOf(hook) < early, hook);
  });

  test("Remove and Clear list say what they are, and what takes focus can be found", () => {
    // Remove shows by the same rule the hand-off reads (canRemove), and finds the next file's Remove by its key.
    assert.match(screen, /\{canRemove\(entry\.phase, busy\) && \(\s+<button type="button" ref=\{removeRef\} data-import-control="remove" data-import-file=\{entry\.key\} onClick=\{onRemove\}[^>]*aria-label=\{`Remove \$\{entry\.name\}`\}>/);
    assert.match(screen, /removeRef=\{controlRef\}/);
    assert.match(screen, /querySelectorAll<HTMLButtonElement>\('\[data-import-control="remove"\]'\) \?\? \[\]\)\.find\(\(button\) => button\.dataset\.importFile === key\)/);
    assert.match(screen, /\{!importing && <button type="button" ref=\{controlRef\} data-import-control="clear" onClick=\{clearList\}/);
    assert.match(screen, /<input ref=\{chooseRef\} type="file" multiple/);
    assert.match(screen, /<h2 id="files-title" ref=\{filesTitleRef\} tabIndex=\{-1\}/);
    assert.match(screen, /<ul ref=\{listRef\} className="space-y-3">/);
    assert.match(screen, /<button type="button" ref=\{importButtonRef\} onClick=\{\(\) => void importAll\(\)\} aria-disabled=\{importing \|\| reading \|\| toImport\.length === 0 \|\| undefined\}/);
    assert.match(screen, /const importReady = gate === "ready" && barShown && toImport\.length > 0;/);
  });
});
