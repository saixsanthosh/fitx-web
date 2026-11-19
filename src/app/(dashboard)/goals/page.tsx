import { redirect } from "next/navigation";
import { legacyGoalsTarget } from "@/components/home/home-panel";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Goals moved onto Home: /goals?tab=goals|today|week (&new=<template>) opens the matching place there. */
export default async function GoalsPage({ searchParams }: { searchParams: SearchParams }) {
  redirect(legacyGoalsTarget(await searchParams));
}
