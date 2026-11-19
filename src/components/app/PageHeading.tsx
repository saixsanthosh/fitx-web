import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/PageHeader";

/** Kept for pages not yet moved to PageHeader. `description` shows as PageHeader's meta line. */
export function PageHeading({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <PageHeader title={title} meta={description} actions={actions} />;
}
