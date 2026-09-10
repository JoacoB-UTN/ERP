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
  // See apps/gestion/next.config.ts's identical comment — dev-mode only,
  // unrelated to apps/api's CORS_ORIGIN, not present in `next start`.
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
