import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { fmtTime } from '@/lib/format';
import { StatusBadge, JOB_STATUS } from './ui';

export function JobList({ jobs, tz, showDate = false }: { jobs: any[]; tz: string; showDate?: boolean }) {
  return (
    <ul className="divide-y divide-stone-100">
      {jobs.map((j) => (
        <li key={j.id}>
          <Link href={`/app/jobs/${j.id}`} className="flex items-center gap-3 px-5 py-3.5 active:bg-stone-50">
            <div className="w-16 shrink-0 text-sm font-semibold tabular-nums text-ink">
              {showDate && <div className="text-xs font-normal text-stone-500">{new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', day: 'numeric' }).format(new Date(j.scheduled_start))}</div>}
              {fmtTime(j.scheduled_start, tz)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-ink">{j.title}</div>
              <div className="truncate text-sm text-stone-500">{j.property?.address}</div>
            </div>
            <StatusBadge map={JOB_STATUS} value={j.status} />
            <ChevronRight className="size-4 text-stone-400" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
