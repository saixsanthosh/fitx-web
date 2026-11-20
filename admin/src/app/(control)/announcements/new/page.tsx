import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AnnouncementForm } from "@/components/announcement-form";
import { PageHead } from "@/components/console/ui";
import { requireAdmin } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "New announcement" };

export default async function NewAnnouncementPage() {
  await requireAdmin("announcements.manage");
  return (
    <div className="page-stack narrow-stack">
      <Link href="/announcements" className="text-link back-link"><ArrowLeft aria-hidden="true" size={15} />Announcements</Link>
      <PageHead eyebrow="Announcements" title="New" meta="Saved as a draft until you publish it" />
      <section className="table-panel form-panel"><AnnouncementForm submitLabel="Save draft" /></section>
    </div>
  );
}
