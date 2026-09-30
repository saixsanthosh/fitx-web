import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return <main className="grid min-h-dvh place-items-center px-5 py-16"><section className="max-w-lg text-center"><p className="font-mono text-sm tracking-[.3em] text-fitx-primary">404</p><h1 className="mt-4 text-3xl font-semibold">This page is not here.</h1><p className="mt-3 text-sm leading-6 text-fitx-text-secondary">The address may have changed or the page may no longer be available.</p><Link href="/" className="fitx-button mt-7 min-h-11 px-4"><ArrowLeft size={16}/>Back to FITX</Link></section></main>;
}
