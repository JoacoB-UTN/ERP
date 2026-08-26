import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // See apps/gestion/next.config.ts's identical comment — dev-mode only,
  // unrelated to apps/api's CORS_ORIGIN, not present in `next start`.
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
