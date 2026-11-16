import { permanentRedirect } from "next/navigation";

/** FITX is for individual training; this old address now points to the features page. */
export default function ForGymsPage() {
  permanentRedirect("/features");
}
