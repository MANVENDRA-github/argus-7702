export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-4">
        <h1 className="text-3xl font-semibold">Argus</h1>
        <p className="text-sm text-zinc-500">
          Security-first EIP-7702 smart wallet &mdash; testnet only.
        </p>
        <p className="text-xs text-zinc-400">
          Pre-implementation skeleton. See ARCHITECTURE.md for the design.
        </p>
      </div>
    </main>
  );
}
