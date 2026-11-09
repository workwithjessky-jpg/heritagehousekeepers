import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: '12mb' } },
  images: { remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }] },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        // geolocation + camera are needed by the cleaner portal on our own origin only
        { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(self), microphone=()' },
      ],
    }];
  },
};
export default nextConfig;
