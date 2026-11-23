"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import exploreStyles from "../Explore.module.css";
import { StoryTray } from "./StoryTray";

/** /explore/stories: the story tray on its own page (the feed shows the same tray on top once it is switched in). */
export function StoriesView() {
  return (
    <div className={`${exploreStyles.narrow} flex flex-col gap-5`}>
      <PageHeader title="Stories" />
      <StoryTray />
    </div>
  );
}
