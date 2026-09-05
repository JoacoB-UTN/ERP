import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server output for the ERP Server installer: `next build`
  // emits `.next/standalone` with a minimal server.js and only the modules the
  // app actually traces, instead of requiring the whole npm workspace tree to
  // be shipped and installed on the customer's PC.
  //
  // NOTE: this is `standalone`, NOT the `export` discussed in
  // docs/desktop-lan-architecture.md. That document rules out a STATIC EXPORT
  // because these apps have dynamic routes with no generateStaticParams —
  // still true. Standalone keeps the Node server and every dynamic route, so
  // that objection does not apply; nothing about routing or rendering changes.
  output: 'standalone',
  // In an npm-workspaces monorepo the traced root must be the repo root, or
  // Next infers this app's own folder and omits the hoisted node_modules and
  // the @erp/* workspace packages from the standalone output.
  outputFileTracingRoot: path.join(__dirname, '../..'),
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
