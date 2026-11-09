import Image from 'next/image';

/** Text wordmark matching the Heritage Housekeepers logo (flared serif caps). */
export function Wordmark({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return (
    <div className={`leading-none ${className}`}>
      <div className={`font-display tracking-[0.12em] text-ink ${compact ? 'text-lg' : 'text-2xl'}`}>HERITAGE</div>
      <div className={`font-display tracking-[0.32em] text-stone-500 ${compact ? 'mt-0.5 text-[9px]' : 'mt-1 text-[11px]'}`}>HOUSEKEEPERS</div>
    </div>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return <Image src="/heritage-logo.jpg" alt="Heritage Housekeepers" width={800} height={320} priority className={`mix-blend-multiply ${className}`} />;
}
