import { redirect } from 'next/navigation';

export default function JobsIndex() {
  redirect('/admin/schedule?view=list');
}
