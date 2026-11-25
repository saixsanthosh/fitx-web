import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import { evidenceFacts, type EvidenceFact } from "@/lib/explore-evidence-facts";
import type { ContentState, TargetType } from "@/lib/explore-rules";
import { logServerError } from "@/lib/log";
import type { createAdminSupabase } from "@/lib/supabase/admin";

// The one Admin file that may read Explore's message tables (admin/tests/explore-privacy.test.mjs enforces it). A
// moderator sees only what the reporter sent: the report's own snapshot of the one reported message (its body, time
// and sender), and whether that message is still there. Never the conversation, never any other message.

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabase>>;

/** Signed links live this long (BRIEF-2 3.8: 300 s). */
export const EVIDENCE_LINK_SECONDS = 300;
const BUCKET = "social-media";
const MEDIA_PATH = /^(?:[0-9a-f-]{36}\/(?:[0-9a-f-]{36}\/[0-9]p?\.(?:webp|jpg|mp4)|profile\/[a-z0-9-]{1,40}\.(?:webp|jpg))|communities\/[0-9a-f-]{36}\/cover\.webp)$/;

export type EvidenceMedia = { kind: "image" | "video"; url: string | null; posterUrl: string | null };

export type Evidence = {
  /** The text the snapshot holds (a caption, a comment or message body, a bio or a description). */
  text: string | null;
  /** Named facts in Admin's own words (evidenceFacts), in order. */
  facts: EvidenceFact[];
  media: EvidenceMedia[];
  /** True once the hourly clean-up purged the snapshot (90 days after review). */
  purged: boolean;
};

const str = (value: unknown, max = 2000): string | null => (typeof value === "string" && value.trim() ? value.slice(0, max) : null);

/** A 300-second signed link to an Explore file, or null for a path that is not one or a file that is gone. */
export async function signedLink(admin: AdminClient, path: unknown): Promise<string | null> {
  if (typeof path !== "string" || !MEDIA_PATH.test(path)) return null;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, EVIDENCE_LINK_SECONDS);
  if (error) {
    // A file the owner or a removal already deleted cannot be signed; the page says so.
    return null;
  }
  return data?.signedUrl ?? null;
}

/** The report's snapshot as Admin shows it, with each picture or video signed for 300 seconds. */
export async function readEvidence(admin: AdminClient, targetType: TargetType, snapshot: Record<string, unknown> | null): Promise<Evidence> {
  await requireAdmin("explore.view");
  if (!snapshot) return { text: null, facts: [], media: [], purged: true };
  const facts = evidenceFacts(targetType, snapshot);
  let body: string | null = null;
  const media: EvidenceMedia[] = [];
  switch (targetType) {
    case "post": {
      body = str(snapshot.caption);
      const items = Array.isArray(snapshot.media) ? snapshot.media.slice(0, 10) : [];
      for (const item of items as Array<Record<string, unknown>>) {
        const video = item.kind === "video";
        media.push({ kind: video ? "video" : "image", url: await signedLink(admin, item.path), posterUrl: video ? await signedLink(admin, item.poster_path) : null });
      }
      break;
    }
    case "comment":
      body = str(snapshot.body);
      break;
    case "story": {
      body = str(snapshot.caption);
      const video = snapshot.kind === "video";
      media.push({ kind: video ? "video" : "image", url: await signedLink(admin, snapshot.path), posterUrl: video ? await signedLink(admin, snapshot.poster_path) : null });
      break;
    }
    case "message":
      body = str(snapshot.body);
      break;
    case "account": {
      body = str(snapshot.bio);
      const avatar = await signedLink(admin, snapshot.avatar_path);
      if (avatar) media.push({ kind: "image", url: avatar, posterUrl: null });
      break;
    }
    case "community":
      body = str(snapshot.description);
      break;
    case "challenge":
      break;
  }
  return { text: body, facts, media, purged: false };
}

/** Whether the one reported message is still there, and its moderation state; nothing else about it is read. */
export async function messageStateOf(admin: AdminClient, messageId: string): Promise<ContentState | null> {
  const { data, error } = await admin.from("social_messages").select("moderation_state,deleted_at").eq("id", messageId).maybeSingle();
  if (error) {
    logServerError("data.explore_message_state", error);
    return null;
  }
  if (!data || (data as { deleted_at?: unknown }).deleted_at) return "gone";
  const state = (data as { moderation_state?: unknown }).moderation_state;
  return state === "limited" || state === "hidden" ? state : "visible";
}
