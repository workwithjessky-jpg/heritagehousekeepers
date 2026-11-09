import { Logo } from './brand';
import { Card } from './ui';

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-sand to-cream px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo className="mx-auto mb-6 h-auto w-60" />
        <Card className="p-6 sm:p-7">{children}</Card>
        <p className="mt-6 text-center text-xs text-stone-500">Heritage Housekeepers · Operations Hub</p>
      </div>
    </main>
  );
}
