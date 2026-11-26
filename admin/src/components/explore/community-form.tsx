"use client";

import { useActionState, useId, useRef } from "react";
import { saveCommunity } from "@/app/(control)/explore/actions";
import { Panel } from "@/components/console/ui";
import { keepTyped } from "@/components/content/keep-typed";
import { CoverPicker } from "@/components/explore/cover-picker";
import { BusyButton, FormResult } from "@/components/form-kit";
import { fieldAria } from "@/components/form-rules";
import { IDLE } from "@/lib/content/form";
import { COMMUNITY_LIMITS } from "@/lib/explore-rules";
import styles from "./explore.module.css";

export type CommunityDefaults = { id: string; name: string; slug: string; description: string; visibility: "public" | "private"; hasCover: boolean };

/**
 * A community's details and cover. A refusal comes back beside the Save button with every field (and a chosen cover)
 * kept as typed; the field it is about is marked and focused. A save opens the community's page.
 */
export function CommunityForm({ community, coverUrl, moderator, className }: { community: CommunityDefaults | null; coverUrl: string | null; moderator: boolean; className?: string }) {
  const [state, action, pending] = useActionState(saveCommunity, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const resultId = useId();
  const slugNote = useId();
  const aria = (name: string) => fieldAria(state, name, resultId);
  const slug = aria("slug");
  return (
    <form ref={formRef} action={action} onSubmit={keepTyped(action)} className={`stack-form ${className ?? ""}`}>
      {community && <input type="hidden" name="id" value={community.id} />}
      <Panel title="Details">
        <fieldset className={`stack-form ${styles.fieldset}`} disabled={!moderator}>
          <label>Name<input name="name" required maxLength={COMMUNITY_LIMITS.name} defaultValue={community?.name ?? ""} {...aria("name")} /></label>
          <label>Address<input name="slug" maxLength={COMMUNITY_LIMITS.slugMax} pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" defaultValue={community?.slug ?? ""} aria-invalid={slug["aria-invalid"]} aria-describedby={slug["aria-describedby"] ? `${slugNote} ${resultId}` : slugNote} /></label>
          <p className="field-note" id={slugNote}>Lower-case letters, digits and dashes. Leave it empty to make one from the name.</p>
          <label>Description<textarea name="description" maxLength={COMMUNITY_LIMITS.description} rows={3} defaultValue={community?.description ?? ""} {...aria("description")} /></label>
          <label>Who can join<select name="visibility" defaultValue={community?.visibility ?? "public"} {...aria("visibility")}><option value="public">Public: adults join freely</option><option value="private">Private: by request</option></select></label>
          <CoverPicker currentUrl={coverUrl} />
          {community?.hasCover && <label className="check-label"><input type="checkbox" name="remove_cover" />Remove the cover</label>}
        </fieldset>
      </Panel>
      {moderator && <BusyButton pending={pending} className="primary-button" pendingLabel="Saving…">Save community</BusyButton>}
      <FormResult id={resultId} state={state} pending={pending} formRef={formRef} />
    </form>
  );
}
