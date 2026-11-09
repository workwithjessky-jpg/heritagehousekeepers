export const dynamic = 'force-dynamic';

import { AuthShell } from '@/components/auth-shell';

export const metadata = { title: 'Setup required' };

// Shown only while Supabase environment variables are missing.
export default function SetupPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return (
    <AuthShell>
      <h1 className="text-lg font-semibold text-ink">{configured ? 'Setup complete' : 'Connect your database'}</h1>
      {configured ? (
        <p className="mt-2 text-sm text-stone-600">Supabase is configured. <a className="text-sage-700 underline" href="/login">Go to sign in</a>.</p>
      ) : (
        <div className="mt-2 space-y-2 text-sm text-stone-600">
          <p>The Operations Hub needs a Supabase project before anyone can sign in.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Copy <code className="rounded bg-stone-100 px-1">.env.example</code> to <code className="rounded bg-stone-100 px-1">.env.local</code>.</li>
            <li>Fill in the Supabase URL, anon key and service-role key.</li>
            <li>Run the migrations, then <code className="rounded bg-stone-100 px-1">npm run create-owner</code>.</li>
            <li>Restart the dev server.</li>
          </ol>
          <p>Full steps are in <code className="rounded bg-stone-100 px-1">README.md</code>.</p>
        </div>
      )}
    </AuthShell>
  );
}
