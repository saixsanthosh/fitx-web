export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-8">
      <div aria-hidden="true" className="auth-ambient pointer-events-none absolute inset-0 overflow-hidden">
        <span className="auth-orb auth-orb-one" />
        <span className="auth-orb auth-orb-two" />
        <span className="auth-orb auth-orb-three" />
      </div>
      <div className="relative z-10 w-full max-w-[448px]">{children}</div>
    </main>
  );
}
