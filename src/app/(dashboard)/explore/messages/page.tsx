import type { Metadata } from "next";
import { Suspense } from "react";
import { MessagesView } from "@/components/social/messages/MessagesView";

export const metadata: Metadata = { title: "Messages" };

/** /explore/messages[?box=requests|?to=<username>|?share=<post id>]: the inbox, Requests and new messages. */
export default function MessagesPage() {
  return (
    <Suspense>
      <MessagesView />
    </Suspense>
  );
}
