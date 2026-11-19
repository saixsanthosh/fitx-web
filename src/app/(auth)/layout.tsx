import type { Metadata } from "next";
import { AuthChrome } from "@/components/auth/AuthChrome";
import { ShellEffects } from "@/components/layout/ShellEffects";
import { SkipLink } from "@/components/layout/SkipLink";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: null,
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SkipLink />
      <ShellEffects />
      <AuthChrome>{children}</AuthChrome>
    </>
  );
}
