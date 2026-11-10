/** Instant placeholder shown while a page's data loads, so menu taps feel immediate. */
export function PageLoading({ compact = false }: { compact?: boolean }) {
  return (
    <div className="animate-pulse" role="status" aria-label="Loading">
      <div className="mb-6 h-7 w-56 rounded-lg bg-stone-200" />
      <div className={compact ? 'space-y-3' : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4'}>
        {Array.from({ length: compact ? 3 : 4 }).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-stone-200/70" />)}
      </div>
      <div className="mt-6 h-72 rounded-2xl bg-stone-200/60" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
