import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FilmLab from "./FilmLab";
import { labEnabled } from "./lab-gate";

/**
 * The film lab (BRIEF-2 3.2): renders exact frames of a film for `scripts/brand/films/render.mjs`. Development only,
 * and only when the server was started with FITX_LAB=1; everywhere else (every production build) it is a 404.
 */
export const metadata: Metadata = {
  title: "Film lab",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function FilmLabPage() {
  if (!labEnabled(process.env)) notFound();
  return <FilmLab />;
}
