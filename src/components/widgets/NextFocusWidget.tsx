"use client";

import type { ReactNode } from "react";
import { Compass } from "lucide-react";
import type { ActivitiesResult } from "@/lib/data/activities";
import type { FoodDays } from "@/lib/data/meals";
import type { SummaryResult } from "@/lib/data/today";
import { improveNext, proteinTargetFrom } from "@/lib/domain/insights";
import { todayTargets } from "@/lib/domain/today";
import { InsightList } from "./InsightList";
import type { GoalsData, Resource, TrainingHistory } from "./useHomeData";
import { WidgetCard, WidgetError, WidgetSkeleton } from "./WidgetCard";

/** Home's "Focus next": what the member's own logs suggest working on (src/lib/domain/insights.ts). */
export function NextFocusWidget({ date, training, activities, food, summary, goals }: {
  date: string;
  training: Resource<TrainingHistory>;
  activities: Resource<ActivitiesResult>;
  food: Resource<FoodDays>;
  summary: Resource<SummaryResult>;
  goals: Resource<GoalsData>;
}) {
  const settled = (resource: Resource<unknown>) => resource.data !== null || resource.status === "error";
  let body: ReactNode;
  if (!training.data || !food.data) {
    const failed = training.status === "error" ? training : food.status === "error" ? food : null;
    body = failed ? <WidgetError message={failed.error} onRetry={failed.reload} /> : <WidgetSkeleton label="Looking at your recent logs" />;
  } else if (!settled(activities) || !settled(summary)) {
    body = <WidgetSkeleton label="Looking at your recent logs" />;
  } else {
    const target = summary.data ? todayTargets(summary.data.summary, goals.data?.goals).protein : null;
    const result = improveNext({
      today: date,
      sessions: training.data.sessions,
      activityStarts: activities.data?.available ? activities.data.activities.map((activity) => activity.startedAt) : null,
      activitiesFailed: activities.status === "error" && !activities.data,
      foodDays: food.data.days,
      proteinTarget: proteinTargetFrom(target),
    });
    body = <InsightList insights={result.insights.slice(0, 3)} status={result.status} />;
  }
  return (
    <WidgetCard title="Focus next" icon={<Compass size={16} />} href="/progress#focus-next" hrefLabel="See everything on Progress">
      {body}
    </WidgetCard>
  );
}
