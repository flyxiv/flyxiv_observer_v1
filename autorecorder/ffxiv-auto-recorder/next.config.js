/** @type {import('next').NextConfig} */
const path = require('path');
const nextConfig = {
  reactStrictMode: true,
  // Silence workspace root warning by pinning tracing root to repo root
  outputFileTracingRoot: path.join(__dirname, '..'),
};

module.exports = nextConfig
