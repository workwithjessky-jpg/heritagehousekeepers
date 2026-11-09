import Image from 'next/image';

/** The official Heritage Housekeepers logo (transparent PNG). */
export function Logo({ className = '', priority = true }: { className?: string; priority?: boolean }) {
  return <Image src="/heritage-logo.png" alt="Heritage Housekeepers" width={740} height={221} priority={priority} className={className} />;
}
