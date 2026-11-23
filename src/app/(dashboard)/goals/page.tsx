import { redirect } from "next/navigation";
import { legacyGoalsTarget } from "@/components/home/home-panel";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Goals moved to Progress: /goals?tab=goals (&new=<template>) opens them there; ?tab=today opens Home, ?tab=week Workouts. */
export default async function GoalsPage({ searchParams }: { searchParams: SearchParams }) {
  redirect(legacyGoalsTarget(await searchParams));
}
