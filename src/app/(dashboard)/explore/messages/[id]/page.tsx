import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConversationView } from "@/components/social/messages/ConversationView";
import { isUuid } from "@/lib/social/paths";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conversationId = id.toLowerCase();
  if (!isUuid(conversationId)) notFound();
  return <ConversationView id={conversationId} />;
}
