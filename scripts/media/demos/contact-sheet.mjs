#!/usr/bin/env node
// Contact sheets for the eye check (wave 2, brief 3.5), the gate before anything ships: each exercise on one row,
// with the Free Exercise DB start and end photos, the male and female start and end frames, the captions, the
// ledger status and pose verdict of each frame, and the catalogue steps beside them.
//
//   node scripts/media/demos/contact-sheet.mjs [--set=priority|ids:<a,b>] [--pose=<results.json>] [--per-sheet=20]
//
// Writes HTML pages to .alteration/media/demos/sheets/ (outside the repo) that open the local files directly.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_WORK_DIR, MODELS, PRIORITY_FILE, encodedFile, jobKey, readLedger, referenceFile } from "../generate-demos.mjs";

export const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function cell(file, label, note) {
  const image = file && existsSync(file) ? `<img src="${escapeHtml(pathToFileURL(file).href)}" alt="">` : `<div class="none">not made</div>`;
  return `<figure>${image}<figcaption><b>${escapeHtml(label)}</b>${note ? `<br>${escapeHtml(note)}` : ""}</figcaption></figure>`;
}

/** One sheet's HTML. `steps(id)` gives the catalogue steps; `pose` maps "<id>/<model>" to a verdict. */
export function sheetHtml({ items, work, ledger, steps = () => [], pose = new Map(), title }) {
  const rows = items.map((item) => {
    const cells = [cell(referenceFile(work, item, 0), "Reference start"), cell(referenceFile(work, item, 1), "Reference end")];
    for (const model of MODELS) {
      for (const frame of [0, 1]) {
        const entry = ledger.images[jobKey(item.id, model, frame)];
        cells.push(cell(encodedFile(work, item.id, model, frame), `${model} ${frame === 0 ? "start" : "end"}`, [entry?.status ?? "not made", item.captions?.[frame]].filter(Boolean).join(" · ")));
      }
    }
    const verdicts = MODELS.map((model) => `${model}: ${pose.get(`${item.id}/${model}`) ?? "no pose check yet"}`).join(" · ");
    const list = steps(item.id).map((step) => `<li>${escapeHtml(step)}</li>`).join("");
    return `<section><h2>${escapeHtml(item.name)} <small>${escapeHtml(item.id)}</small></h2><p class="meta">${escapeHtml(verdicts)}</p><div class="row">${cells.join("")}</div><ol>${list}</ol></section>`;
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
body{font:14px system-ui,sans-serif;margin:24px;background:#f4f4f2;color:#1c201d}section{background:#fff;border-radius:12px;padding:16px;margin:0 0 16px}
.row{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}figure{margin:0}img,.none{width:100%;aspect-ratio:4/3;object-fit:contain;background:#e8e8e4;border-radius:8px}
.none{display:grid;place-items:center;color:#777}figcaption{font-size:12px;margin-top:4px}small{color:#666;font-weight:400}.meta{color:#555;margin:4px 0 10px}ol{margin:10px 0 0;padding-left:20px;color:#444}
</style></head><body><h1>${escapeHtml(title)}</h1>${rows.join("")}</body></html>\n`;
}

async function main(argv) {
  const set = argv.find((arg) => arg.startsWith("--set="))?.slice(6) ?? "priority";
  const perSheet = Number(argv.find((arg) => arg.startsWith("--per-sheet="))?.slice(12) ?? 20);
  const poseFile = argv.find((arg) => arg.startsWith("--pose="))?.slice(7);
  const priority = JSON.parse(readFileSync(PRIORITY_FILE, "utf8"));
  const ids = set.startsWith("ids:") ? set.slice(4).split(",") : null;
  const items = ids ? priority.set.filter((item) => ids.includes(item.id)) : priority.set;
  const ledger = readLedger(DEFAULT_WORK_DIR);
  const pose = new Map((poseFile ? JSON.parse(readFileSync(poseFile, "utf8")).results : []).map((result) => [result.id, `${result.verdict}${result.reasons?.length ? ` (${result.reasons[0]})` : ""}`]));
  const builder = await import("../demo-priority.mjs");
  const data = await builder.loadRepoData();
  const steps = (id) => data.guideSteps(data.instructions.get(id) ?? []).map((step) => step.text);
  const out = path.join(DEFAULT_WORK_DIR, "sheets");
  mkdirSync(out, { recursive: true });
  for (let start = 0, page = 1; start < items.length; start += perSheet, page += 1) {
    const file = path.join(out, `sheet-${String(page).padStart(3, "0")}.html`);
    writeFileSync(file, sheetHtml({ items: items.slice(start, start + perSheet), work: DEFAULT_WORK_DIR, ledger, steps, pose, title: `FITX demonstrations, sheet ${page}` }));
    console.log(`wrote ${file}`);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => { console.error(error?.message ?? error); process.exitCode = 1; });
}
