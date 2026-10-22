import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API and Socket.IO run on :4000; in production the
// server serves this build itself, so everything is same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'ws://localhost:4000', ws: true },
    },
  },
});
