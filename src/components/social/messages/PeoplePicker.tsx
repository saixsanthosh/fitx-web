"use client";

import { useEffect, useState, type ReactNode } from "react";
import { socialApi, type Db, type SocialAuthor } from "@/lib/social";
import { messagesApi } from "@/lib/social/messages";
import { Avatar } from "../Avatar";
import styles from "./Messages.module.css";

type Props = {
  db: Db;
  userId: string;
  /** Called when a person is chosen. */
  onPick: (person: SocialAuthor) => void;
  /** Ids already chosen or sent to (shown as pressed). */
  picked?: ReadonlySet<string>;
  /** Text after the name, per person (for example "Sent"). */
  trailing?: (person: SocialAuthor) => ReactNode;
  label?: string;
};

/** Search people by name or username; before a search, the member's recent conversations and the accounts they follow. */
export function PeoplePicker({ db, userId, onPick, picked, trailing, label = "Search people" }: Props) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<SocialAuthor[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let live = true;
    const text = query.trim();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        if (text.length >= 2) {
          const result = await socialApi.search(db, text);
          if (live) setPeople(result.accounts.filter((person) => person.id !== userId));
        } else {
          const [recent, following] = await Promise.all([
            messagesApi.conversations(db, "inbox").catch(() => []),
            socialApi.followList(db, userId, "following").catch(() => []),
          ]);
          const seen = new Set<string>();
          const list: SocialAuthor[] = [];
          for (const person of [...recent.map((c) => c.other), ...following.map((f) => f.user)]) {
            if (!person || person.id === userId || seen.has(person.id)) continue;
            seen.add(person.id);
            list.push(person);
          }
          if (live) setPeople(list.slice(0, 30));
        }
      } catch {
        if (live) setPeople([]);
      } finally {
        if (live) setSearching(false);
      }
    }, text.length >= 2 ? 250 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [db, query, userId]);

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        className={styles.search}
        aria-label={label}
        placeholder="Name or username"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
        enterKeyHint="search"
      />
      <div className={styles.people} role="list" aria-busy={searching} aria-label={query.trim().length >= 2 ? "Search results" : "Suggested people"}>
        {people === null && <p className={styles.time}>Loading</p>}
        {people && !people.length && !searching && (
          <p className={styles.time}>{query.trim().length >= 2 ? "No one matches that." : "Search for someone by name or username."}</p>
        )}
        {people?.map((person) => (
          <div role="listitem" key={person.id}>
            <button type="button" className={`${styles.person} w-full`} aria-pressed={picked?.has(person.id) ?? undefined} onClick={() => onPick(person)}>
              <Avatar user={person} size={40} />
              <span className={styles.personText}>
                <span className={styles.personName}>{person.display_name}</span>
                <span className={styles.personSub}>@{person.username}</span>
              </span>
              {trailing?.(person)}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
