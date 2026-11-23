import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileView } from "@/components/social/ProfileView";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const name = decodeURIComponent(username).replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(name)) notFound();
  return <ProfileView key={name} username={name} />;
}
