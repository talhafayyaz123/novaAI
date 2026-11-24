const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

module.exports = {
  async rewrites() {
    return [
      {
        source: '/api/backend/:path*',
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};
