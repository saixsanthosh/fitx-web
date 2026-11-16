import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AnnouncementForm } from "@/components/announcement-form";
import { requireAdmin } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "New announcement" };

export default async function NewAnnouncementPage() {
  await requireAdmin("announcements.manage");
  return (
    <div className="page-stack narrow-stack">
      <Link href="/announcements" className="text-link back-link"><ArrowLeft aria-hidden="true" size={15} />Announcements</Link>
      <div className="page-heading-row"><div><p className="eyebrow">COMMUNICATIONS</p><h1>New announcement</h1><p className="page-lede">Saved as a draft. Publish it from the next screen when it reads right.</p></div></div>
      <section className="table-panel form-panel"><AnnouncementForm submitLabel="Save draft" /></section>
    </div>
  );
}
