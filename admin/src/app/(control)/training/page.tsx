import type { Metadata } from "next";
import { Activity, Search } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { listExercises } from "@/lib/data/exercises";
import { ModuleState } from "@/components/module-state";
import { setExerciseActive } from "./actions";

export const metadata: Metadata = { title: "Training" };

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ q?: string; state?: string }> }) {
  await requireAdmin("content.manage");
  const params = await searchParams;
  const term = (params.q ?? "").slice(0, 80);
  const result = await listExercises(term);
  const notices: Record<string, string> = { saved: "Exercise visibility updated.", save_failed: "The exercise update could not be saved.", invalid: "The submitted exercise was not valid.", configuration: "Server data access is not configured.", forbidden: "Your role cannot change exercise visibility." };
  return (
    <div className="page-stack">
      <div className="page-heading-row"><div><p className="eyebrow">MOVEMENT LIBRARY</p><h1>Training</h1><p className="page-lede">Manage the live FITX exercise catalog and its visibility.</p></div><span className="page-heading-icon"><Activity aria-hidden="true" size={20} /></span></div>
      {params.state && notices[params.state] && <p className={`inline-notice ${params.state === "saved" ? "notice-success" : "notice-error"}`} role="status">{notices[params.state]}</p>}
      {result.state === "ready" ? <section className="table-panel">
        <div className="table-heading"><div><h2>Exercise catalog</h2><p>Records from <code>exercise_library</code>; visibility updates are written to the audit log.</p></div><span className="data-badge">Live records</span></div>
        <form action="/training" className="table-search"><label className="search-label" htmlFor="exercise-search"><Search aria-hidden="true" size={17} />Search exercises</label><div><input id="exercise-search" name="q" defaultValue={term} maxLength={80} placeholder="Name contains…" /><button className="quiet-button" type="submit">Search</button></div></form>
        {result.exercises.length ? <div className="table-scroll"><table><thead><tr><th>Exercise</th><th>Primary muscle</th><th>Equipment</th><th>Difficulty</th><th>Visibility</th><th>Update</th></tr></thead><tbody>
          {result.exercises.map((exercise) => <tr key={exercise.id}><td><strong>{exercise.name}</strong><small className="table-subline">{exercise.id}</small></td><td>{exercise.primary_muscle}</td><td>{exercise.equipment.join(", ") || "Not specified"}</td><td><span className="difficulty-label">{exercise.difficulty}</span></td><td><span className={`status-pill ${exercise.is_active ? "status-good" : "status-neutral"}`}><i />{exercise.is_active ? "Published" : "Hidden"}</span></td><td><form action={setExerciseActive}><input type="hidden" name="exerciseId" value={exercise.id} /><input type="hidden" name="active" value={String(!exercise.is_active)} /><button className="quiet-button" type="submit">{exercise.is_active ? "Hide" : "Publish"}</button></form></td></tr>)}
        </tbody></table></div> : <div className="empty-state"><h3>No matching exercises</h3><p>Try another exercise name.</p></div>}
        <div className="table-footer"><span>Up to 100 catalog records shown per search.</span><span>{result.exercises.length} returned</span></div>
      </section> : <ModuleState state={result.state} />}
    </div>
  );
}
