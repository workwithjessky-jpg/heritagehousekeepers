import type { MetadataRoute } from 'next';

// Lets the Ops Hub be added to a phone's home screen (required on iPhone for push alerts).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Heritage Operations Hub',
    short_name: 'Heritage Ops',
    description: 'Scheduling, attendance and alerts for Heritage Housekeepers.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#faf8f3',
    theme_color: '#44583b',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
