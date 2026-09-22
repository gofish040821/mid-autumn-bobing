import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_PORT = process.env.SERVER_PORT ?? '3001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 监听 0.0.0.0，手机可通过局域网 IP 访问
    port: Number(process.env.CLIENT_PORT ?? 5173),
    strictPort: false,
    proxy: {
      '/socket.io': {
        target: `http://localhost:${SERVER_PORT}`,
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
