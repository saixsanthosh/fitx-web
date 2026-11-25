import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileView } from "@/components/social/ProfileView";
import { routeUsername } from "@/lib/social/route-params";

type Props = { params: Promise<{ username: string }> };

/** Each account's page is titled with its username ("@ben.okafor · Explore · FITX"); a malformed address is not found. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const name = routeUsername((await params).username);
  if (!name) notFound();
  return { title: `@${name}` };
}

export default async function ProfilePage({ params }: Props) {
  const name = routeUsername((await params).username);
  if (!name) notFound();
  return <ProfileView key={name} username={name} />;
}
