import type { Metadata } from "next";
import { OnboardingFlow } from "./OnboardingFlow";

export const metadata: Metadata = { title: "Set up FITX" };

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
