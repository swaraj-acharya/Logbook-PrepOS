import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' }
    ] }];
  }
};
export default nextConfig;
