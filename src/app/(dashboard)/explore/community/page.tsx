import type { Metadata } from "next";
import { CommunityDirectory } from "@/components/social/community/CommunityDirectory";

export const metadata: Metadata = { title: "Community" };

/** /explore/community: the communities FITX runs, and the open challenges. */
export default function CommunityPage() {
  return <CommunityDirectory />;
}
