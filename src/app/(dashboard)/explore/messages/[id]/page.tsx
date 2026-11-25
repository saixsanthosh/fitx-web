import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConversationView } from "@/components/social/messages/ConversationView";
import { routeId } from "@/lib/social/route-params";

type Props = { params: Promise<{ id: string }> };

/** A malformed address is not found, and titled so (not "Conversation"). Never a name: the tab is not private. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!routeId((await params).id)) notFound();
  return { title: "Conversation" };
}

export default async function ConversationPage({ params }: Props) {
  const conversationId = routeId((await params).id);
  if (!conversationId) notFound();
  return <ConversationView id={conversationId} />;
}
