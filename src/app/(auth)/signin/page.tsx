"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Mail, Lock, Globe } from "lucide-react";
import { toast } from "sonner";
import { FitxButton } from "@/components/ui/FitxButton";
import { FitxInput } from "@/components/ui/FitxInput";
import { FitxCard } from "@/components/ui/FitxCard";
import { Logo } from "@/components/ui/Logo";
import { BRAND } from "@/config/brand";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const googleOAuthEnabled = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    if (!supabase) {
      toast.error("Auth isn't configured yet. Add your Supabase keys.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    toast.success("Welcome back, warrior.");
    window.location.href = "/dashboard";
  };

  const handleGoogle = async () => {
    const supabase = createClient();
    if (!supabase) {
      toast.error("Auth isn't configured yet. Add your Supabase keys.");
      return;
    }
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
    });
    if (error) {
      toast.error(error.message);
      setGoogleLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="text-center mb-8">
        <Link href="/" className="inline-flex items-center gap-2 mb-4">
          <Logo size={44} />
          <span className="text-3xl font-display tracking-tight text-fitx-text">{BRAND.name}</span>
        </Link>
        <p className="text-sm text-fitx-text-secondary font-body">Welcome back, warrior</p>
      </div>

      <FitxCard variant="glow" hover={false} className="p-8">
        <form onSubmit={handleSubmit} className="space-y-5">
          <FitxInput
            label="Email"
            type="email"
            placeholder="you@example.com"
            icon={<Mail size={18} />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <FitxInput
            label="Password"
            type="password"
            placeholder="Enter your password"
            icon={<Lock size={18} />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <div className="flex items-center justify-end">
            <Link
              href="/forgot-password"
              className="text-xs text-fitx-primary hover:text-fitx-primary-bright transition-colors font-body"
            >
              Forgot password?
            </Link>
          </div>

          <FitxButton type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
            Sign In
          </FitxButton>
        </form>

        {googleOAuthEnabled && (
          <>
            <div className="mt-6 relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-fitx-divider" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-fitx-card px-4 text-fitx-text-disabled font-body">or continue with</span>
              </div>
            </div>

            <div className="mt-6">
              <FitxButton
                type="button"
                variant="secondary"
                size="md"
                className="w-full"
                icon={<Globe size={18} />}
                loading={googleLoading}
                onClick={handleGoogle}
              >
                Continue with Google
              </FitxButton>
            </div>
          </>
        )}
      </FitxCard>

      {!isSupabaseConfigured && (
        <p className="mt-4 text-center text-[11px] text-fitx-warning font-body">
          Demo mode — add Supabase keys to enable real sign-in.
        </p>
      )}

      <p className="mt-6 text-center text-sm text-fitx-text-secondary font-body">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-fitx-primary hover:text-fitx-primary-bright transition-colors font-semibold">
          Sign Up
        </Link>
      </p>
    </motion.div>
  );
}
