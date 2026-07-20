import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pins the workspace root to this project explicitly — without this, Next.js
  // walks up looking for lockfiles and can pick up an unrelated one in a parent
  // directory (e.g. a stray package-lock.json in the user's home directory).
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
