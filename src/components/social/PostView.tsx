"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Sheet } from "@/components/ui/Sheet";
import { fullDate, relativeTime, SOCIAL_LIMITS, socialApi, toSocialError, type SocialComment, type SocialPost } from "@/lib/social";
import type { Db } from "@/lib/social/api";
import { commentGate } from "@/lib/social/comment-gate";
import { focusAfterRemoval } from "@/lib/social/focus";
import { Avatar } from "./Avatar";
import { useReadyExplore } from "./ExploreContext";
import { PostCard } from "./PostCard";
import { ReportSheet } from "./ReportSheet";
import { RichText } from "./RichText";
import { useAsync } from "./useAsync";
import { useFocusAfterRender } from "./useFocusAfterRender";
import styles from "./Explore.module.css";

const optionsId = (commentId: string) => `comment-options-${commentId}`;

/** One post with its comments and replies. */
export function PostView({ id }: { id: string }) {
  const { db } = useReadyExplore();
  const router = useRouter();
  const post = useAsync(() => socialApi.post(db, id), [db, id]);
  if (post.status === "loading") return <div className={`${styles.skeleton} ${styles.narrow}`} style={{ aspectRatio: "4 / 5.6" }} aria-busy="true" aria-label="Loading post" />;
  if (post.status === "error") return <p className={`${styles.alert} ${styles.narrow}`} role="alert">{post.error}</p>;
  if (!post.data) {
    return (
      <div className={`${styles.empty} ${styles.narrow}`}>
        <h1 className={styles.emptyTitle}>Post not available</h1>
        <p className={styles.emptyText}>It was deleted, or its account is private.</p>
        <Link href="/explore" className="fitx-button fitx-button-secondary">Back to feed</Link>
      </div>
    );
  }
  return (
    <div className={`${styles.narrow} flex flex-col gap-6`}>
      <PageHeader title="Post" className="sr-only" />
      <PostCard db={db} post={post.data} detail priority onChange={post.setData} onRemove={() => router.replace("/explore")} />
      <Comments db={db} post={post.data} onCount={(delta) => post.data && post.setData({ ...post.data, comment_count: Math.max(0, post.data.comment_count + delta) })} />
    </div>
  );
}

function Comments({ db, post, onCount }: { db: Db; post: SocialPost; onCount: (delta: number) => void }) {
  const list = useAsync(() => socialApi.comments(db, post.id, null), [db, post.id]);
  const [replyTo, setReplyTo] = useState<SocialComment | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<SocialComment | null>(null);
  const [options, setOptions] = useState<SocialComment | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfter = useFocusAfterRender();
  const comments = list.data ?? [];
  const gate = commentGate(post);

  const replace = (updated: SocialComment) => list.setData(comments.map((comment) => comment.id === updated.id
    ? { ...updated, replies: comment.replies }
    : { ...comment, replies: comment.replies?.map((reply) => (reply.id === updated.id ? updated : reply)) }));

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      if (editing) {
        replace(await socialApi.editComment(db, editing.id, text));
        setEditing(null);
      } else {
        const added = await socialApi.addComment(db, post.id, replyTo?.id ?? null, text);
        if (added.parent_id) list.setData(comments.map((comment) => comment.id === added.parent_id ? { ...comment, replies: [...(comment.replies ?? []), added] } : comment));
        else list.setData([...comments, { ...added, replies: [] }]);
        onCount(1);
        setReplyTo(null);
      }
      setBody("");
    } catch (error) {
      toast.error(toSocialError(error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(comment: SocialComment) {
    setOptions(null);
    // Every comment's options button, in the order shown (a comment, then its replies).
    const order = comments.flatMap((item) => [item.id, ...(item.replies ?? []).map((reply) => reply.id)]).map(optionsId);
    const gone = [comment.id, ...(comment.replies ?? []).map((reply) => reply.id)].map(optionsId);
    try {
      await socialApi.deleteComment(db, comment.id);
      const removed = 1 + (comment.replies?.length ?? 0);
      list.setData(comments.filter((item) => item.id !== comment.id).map((item) => ({ ...item, replies: item.replies?.filter((reply) => reply.id !== comment.id) })));
      onCount(-removed);
      toast.success("Comment deleted");
      // Its options button goes with it: focus the next comment's (or the one before), else the Comments heading.
      focusAfter(focusAfterRemoval(order, gone), () => heading.current);
    } catch (error) {
      toast.error(toSocialError(error).message);
    }
  }

  const startReply = (comment: SocialComment) => {
    setEditing(null);
    setReplyTo(comment);
    setBody(`@${comment.author.username} `);
    input.current?.focus();
  };

  return (
    <section id="comments" className={styles.panel} aria-labelledby="comments-title">
      <h2 id="comments-title" ref={heading} tabIndex={-1} className={styles.panelTitle}>Comments</h2>
      {list.status === "loading" && <p className={styles.note}>Loading comments</p>}
      {list.status === "error" && <p className={styles.alert} role="alert">{list.error}</p>}
      {list.status === "ready" && !comments.length && post.can_comment && <p className={styles.note}>No comments yet.</p>}
      <ul className={styles.comments}>
        {comments.map((comment) => (
          <li key={comment.id}>
            <CommentRow comment={comment} canReply={post.can_comment} onReply={startReply} onOptions={setOptions} />
            {!!comment.replies?.length && (
              <ul className={styles.replies} aria-label={`Replies to ${comment.author.username}`}>
                {comment.replies.map((reply) => (
                  <li key={reply.id}><CommentRow comment={reply} canReply={post.can_comment} onReply={() => startReply(comment)} onOptions={setOptions} /></li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {/* Where the box would be: why there is none (followers only, or off), which also explains the missing Reply. */}
      {gate && !editing && <p className={`${styles.note} mt-4`}>{gate}</p>}
      {(post.can_comment || editing) && (
        <form className="mt-5 flex flex-col gap-2" onSubmit={(event) => void send(event)}>
          {(replyTo || editing) && (
            <p className={styles.hint}>
              {editing ? "Editing your comment" : `Replying to @${replyTo?.author.username}`}
              <button type="button" className="ml-3 font-semibold underline" onClick={() => { setReplyTo(null); setEditing(null); setBody(""); }}>Cancel</button>
            </p>
          )}
          <div className={styles.composer}>
            <label htmlFor="comment-body" className="sr-only">{editing ? "Edit comment" : "Add a comment"}</label>
            <textarea
              id="comment-body"
              ref={input}
              className="fitx-field"
              rows={1}
              maxLength={SOCIAL_LIMITS.commentChars}
              placeholder={editing ? "Edit comment" : "Add a comment"}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
            />
            <button type="submit" className={styles.smallButton} disabled={busy || !body.trim()}>{editing ? "Save" : "Post"}</button>
          </div>
        </form>
      )}

      <Sheet open={options !== null} onClose={() => setOptions(null)} title="Comment options">
        {options && (
          <div className={styles.menu}>
            {options.mine && <button type="button" className={styles.menuItem} onClick={() => { setEditing(options); setReplyTo(null); setBody(options.body); setOptions(null); window.setTimeout(() => input.current?.focus(), 50); }}>Edit comment</button>}
            {options.can_delete && <button type="button" className={`${styles.menuItem} ${styles.menuDanger}`} onClick={() => void remove(options)}>Delete comment</button>}
            {!options.mine && <button type="button" className={styles.menuItem} onClick={() => { setReport(options.id); setOptions(null); }}>Report comment</button>}
          </div>
        )}
      </Sheet>
      <ReportSheet db={db} target={report ? { type: "comment", id: report } : null} onClose={() => setReport(null)} />
    </section>
  );
}

function CommentRow({ comment, canReply, onReply, onOptions }: { comment: SocialComment; canReply: boolean; onReply: (comment: SocialComment) => void; onOptions: (comment: SocialComment) => void }) {
  return (
    <div className={styles.comment}>
      <Link href={`/explore/u/${comment.author.username}`} aria-label={comment.author.display_name}><Avatar user={comment.author} size={34} /></Link>
      <div className="min-w-0">
        <p className={styles.commentBody}>
          <Link href={`/explore/u/${comment.author.username}`} className={styles.captionName}>{comment.author.username}</Link>
          <RichText text={comment.body} />
        </p>
        <div className={styles.commentMeta}>
          <time dateTime={comment.created_at} title={fullDate(comment.created_at)}>{relativeTime(comment.created_at)}</time>
          {comment.edited_at && <span>Edited</span>}
          {comment.restricted && <span className={styles.restrictedTag}>Restricted: only you and them see this</span>}
          {canReply && <button type="button" onClick={() => onReply(comment)} aria-label={`Reply to ${comment.author.username}`}>Reply</button>}
        </div>
      </div>
      <button type="button" id={optionsId(comment.id)} className={styles.iconButton} aria-label={`Options for ${comment.author.username}’s comment`} onClick={() => onOptions(comment)}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
