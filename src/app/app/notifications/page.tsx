import { requireRole, getSettings } from '@/lib/auth';
import { NotificationList } from '@/components/notification-list';

export const metadata = { title: 'Notifications' };

export default async function CleanerNotifications() {
  await requireRole(['cleaner']);
  const { timezone } = await getSettings();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl text-ink">Notifications</h1>
      <NotificationList tz={timezone} limit={60} />
    </div>
  );
}
