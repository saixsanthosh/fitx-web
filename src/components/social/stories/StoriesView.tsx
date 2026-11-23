"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { useReadyExplore } from "../ExploreContext";
import exploreStyles from "../Explore.module.css";
import { StoryTray } from "./StoryTray";

/** /explore/stories: the story tray on its own page, with a line on how stories work. */
export function StoriesView() {
  const { me } = useReadyExplore();
  return (
    <div className={`${exploreStyles.narrow} flex flex-col gap-5`}>
      <PageHeader title="Stories" />
      <StoryTray />
      <p className={exploreStyles.note}>A story is one photo{me.videos === true ? " or a short video" : ""}. It is gone after 24 hours, and you see who has viewed yours.</p>
    </div>
  );
}
