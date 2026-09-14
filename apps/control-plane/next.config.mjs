/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The registry JSON lives at the repo root, outside this app directory. It is
  // imported at build time and bundled, so the deployed app carries it without
  // filesystem access. See lib/registry.ts for the Postgres swap point.
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};
