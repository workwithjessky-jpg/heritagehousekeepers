import { requireRole, STAFF, getSettings } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { NotificationList } from '@/components/notification-list';

export const metadata = { title: 'Notifications' };

export default async function AdminNotificationsPage() {
  await requireRole(STAFF);
  const { timezone } = await getSettings();
  return (
    <>
      <PageHeader title="Notification center" subtitle="Live alerts for clock-ins, exceptions, requests and schedule changes. Configure which events notify you in Settings." />
      <div className="max-w-3xl"><NotificationList tz={timezone} /></div>
    </>
  );
}
