/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@omaha/shared-types'],
  // Lint is a separate CI gate (`next lint`); a lint failure should not block a
  // production build or container image. Type errors still fail the build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
