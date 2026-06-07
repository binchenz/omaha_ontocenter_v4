/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@omaha/shared-types'],
};

export default nextConfig;
