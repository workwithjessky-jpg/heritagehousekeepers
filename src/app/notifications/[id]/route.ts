import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET /notifications/<id> — marks the viewer's notification read, then opens what it points to.
// RLS limits both the read and the update to the signed-in user's own notifications.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from('notifications').select('link,read_at').eq('id', id).maybeSingle();
  if (data && !data.read_at) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  const link = typeof data?.link === 'string' && data.link.startsWith('/') && !data.link.startsWith('//') ? data.link : '/';
  return NextResponse.redirect(new URL(link, req.url));
}
