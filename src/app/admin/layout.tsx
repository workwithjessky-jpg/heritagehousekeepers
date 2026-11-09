import { AdminShell } from '@/components/admin-shell';
import { requireRole, STAFF, ROLE_LABEL } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(STAFF);
  const supabase = await createClient();
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  return (
    <AdminShell user={{ id: user.id, full_name: user.full_name, role: user.role, roleLabel: ROLE_LABEL[user.role] }} unread={count ?? 0}>
      {children}
    </AdminShell>
  );
}
