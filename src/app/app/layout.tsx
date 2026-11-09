import { CleanerShell } from '@/components/cleaner-shell';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function CleanerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(['cleaner']);
  const supabase = await createClient();
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  return <CleanerShell userId={user.id} unread={count ?? 0}>{children}</CleanerShell>;
}
