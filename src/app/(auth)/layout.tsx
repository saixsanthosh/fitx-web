export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-[radial-gradient(ellipse_at_50%_45%,rgba(22,85,52,.18),transparent_68%)]" />
      <div className="relative z-10 w-full max-w-[448px]">{children}</div>
    </main>
  );
}
