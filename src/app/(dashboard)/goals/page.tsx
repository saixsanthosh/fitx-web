import type { Metadata } from "next";
import { GoalsWorkspace } from "./GoalsWorkspace";
import { isGoalsTab } from "./tabs";
import { GOAL_TEMPLATES } from "@/lib/domain/goals";

export const metadata: Metadata = { title: "Goals" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Goals, the To-Do list and the week in one place: /goals?tab=today|goals|week (&new=<template>). */
export default async function GoalsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const tab = isGoalsTab(params.tab) ? params.tab : "today";
  // A template link (&new=…) always lands on the Goals tab, which opens the editor from the address.
  const template = typeof params.new === "string" && GOAL_TEMPLATES.some((entry) => entry.key === params.new);
  return <GoalsWorkspace initialTab={template ? "goals" : tab} />;
}
