import type { ReactNode } from "react";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6 sm:py-16 lg:px-8"><div className="mb-8 border-b border-fitx-divider pb-7"><p className="text-xs font-semibold uppercase tracking-[.2em] text-fitx-primary">FITX policies</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1><p className="mt-3 text-xs text-fitx-text-disabled">Last updated {updated}</p></div><article className="space-y-7 text-sm leading-7 text-fitx-text-secondary [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-fitx-text [&_a]:text-fitx-primary [&_a]:underline [&_a]:underline-offset-2 [&_li]:ml-5 [&_li]:list-disc">{children}</article></main>;
}
