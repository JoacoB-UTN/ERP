import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // next dev's own anti-DNS-rebinding protection (unrelated to
  // apps/api's CORS_ORIGIN) blocks loading dev assets — HMR, JS chunks —
  // from a host other than "localhost" unless explicitly allowed here.
  // This is dev-mode only: `next start` (a real deployment) has no such
  // restriction. 127.0.0.1 is needed for the Electron thin client's
  // runtime-LAN-addressing acceptance test — see
  // docs/desktop-lan-architecture.md's "Runtime LAN addressing". Add a
  // real LAN IP/hostname here too if testing `next dev` from one.
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
