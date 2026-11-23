"use client";

import { Chip, ChipGroup } from "@/components/ui/Chip";
import { MAX_POST_TOPICS, TOPICS } from "@/lib/social";

/** Up to three topics for a post; Discover's category filters use them. */
export function TopicPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const toggle = (key: string) => {
    if (value.includes(key)) onChange(value.filter((item) => item !== key));
    else if (value.length < MAX_POST_TOPICS) onChange([...value, key]);
  };
  return (
    <ChipGroup multiple label="Topics, up to three">
      {TOPICS.map((topic) => (
        <Chip key={topic.key} selected={value.includes(topic.key)} disabled={!value.includes(topic.key) && value.length >= MAX_POST_TOPICS} onClick={() => toggle(topic.key)}>
          {topic.label}
        </Chip>
      ))}
    </ChipGroup>
  );
}
