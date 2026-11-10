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
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
