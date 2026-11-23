import { permanentRedirect } from "next/navigation";

/** The old Social page is now Explore. */
export default function SocialPage() {
  permanentRedirect("/explore");
}
