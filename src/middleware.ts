import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC = ['/login', '/forgot-password', '/auth', '/setup', '/api/cron'];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Not configured yet: send everything to the setup screen
    if (path.startsWith('/setup')) return NextResponse.next();
    return NextResponse.redirect(new URL('/setup', request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refreshes the session cookie when needed. Do not remove.
  const { data: { user } } = await supabase.auth.getUser();

  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + '/'));
  if (!user && !isPublic) {
    const url = new URL('/login', request.url);
    if (path !== '/') url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)'],
};
