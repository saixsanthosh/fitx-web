import type { Metadata } from "next";
import SignUpForm from "./SignUpForm";

export const metadata: Metadata = {
  title: "Create your FITX account",
};

export default function SignUpPage() {
  return <SignUpForm />;
}
