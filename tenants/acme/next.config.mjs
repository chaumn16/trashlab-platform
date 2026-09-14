/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Core ships compiled ESM; nothing tenant-specific belongs in this file,
  // which is why CODEOWNERS protects it.
  outputFileTracingIncludes: {},
};
