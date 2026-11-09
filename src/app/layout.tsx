import type { Metadata, Viewport } from 'next';
import { Inter, Marcellus } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const marcellus = Marcellus({ subsets: ['latin'], weight: '400', variable: '--font-marcellus' });

export const metadata: Metadata = {
  title: { default: 'Heritage Housekeepers | Operations Hub', template: '%s · Heritage Operations Hub' },
  description: 'Scheduling, attendance, timesheets and payroll for Heritage Housekeepers.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#44583b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${marcellus.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
