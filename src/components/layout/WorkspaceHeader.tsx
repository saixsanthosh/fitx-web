"use client";

import { FormEvent, useEffect, useState } from "react";
import { Bell, Search, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Logo } from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/client";

export function WorkspaceHeader() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    if (!supabase) return;
    void (async () => {
      const auth = await supabase.auth.getUser();
      const user = auth.data.user;
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("name, avatar").eq("id", user.id).maybeSingle();
      let avatarUrl: string | null = profile?.avatar || null;
      if (avatarUrl && !avatarUrl.startsWith("http")) {
        const signed = await supabase.storage.from("fitx-user-media").createSignedUrl(avatarUrl, 3600);
        avatarUrl = signed.data?.signedUrl || null;
      }
      if (active) {
        setName(profile?.name || user.user_metadata?.name || user.email?.split("@")[0] || "");
        setAvatar(avatarUrl);
      }
    })();
    return () => { active = false; };
  }, []);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (value) router.push(`/exercises?q=${encodeURIComponent(value)}`);
  }

  return (
    <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between gap-4 border-b border-fitx-divider bg-[#0b1112]/90 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <div className="flex items-center gap-2 lg:hidden"><Logo size={34} /></div>
      <form onSubmit={search} className="hidden w-full max-w-[350px] items-center gap-2 rounded-lg border border-fitx-border bg-[#0b1112] px-3 sm:flex">
        <Search size={16} className="text-fitx-text-disabled" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search exercises" placeholder="Search exercises…" className="h-10 w-full bg-transparent text-sm text-fitx-text outline-none placeholder:text-fitx-text-disabled" />
      </form>
      <div className="ml-auto flex items-center gap-2 sm:gap-4">
        <button type="button" aria-label="Notifications" title="Notifications" className="relative grid h-10 w-10 place-items-center rounded-lg text-fitx-text-secondary hover:bg-white/[.04] hover:text-fitx-text">
          <Bell size={18} />
        </button>
        <button type="button" onClick={() => router.push("/profile")} aria-label="Open profile" className="flex items-center gap-2 rounded-full focus-visible:outline">
          {avatar ? <Image src={avatar} alt="" width={36} height={36} unoptimized className="h-9 w-9 rounded-full border border-fitx-border object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-full border border-fitx-border bg-fitx-surface-variant text-fitx-text-secondary"><UserRound size={17} /></span>}
          <span className="hidden max-w-28 truncate text-sm text-fitx-text-secondary md:block">{name}</span>
        </button>
      </div>
    </header>
  );
}
