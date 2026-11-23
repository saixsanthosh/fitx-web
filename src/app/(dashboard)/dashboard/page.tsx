import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { homeRedirect } from "@/components/home/home-panel";
import { HomeView } from "./HomeView";

export const metadata: Metadata = { title: "Home" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Home: a greeting and the quote of the day. Its old panel links (`?panel=goals|todo|week`, `&new=<template>`)
 * go to their new places: goals on Progress, planned workouts in Workouts, and To-Do (removed) to plain Home.
 */
export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const target = homeRedirect(await searchParams);
  if (target) redirect(target);
  return <HomeView />;
}
