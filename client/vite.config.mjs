import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  esbuild: {
    // Ensure JSX in .jsx/.js is parsed before import analysis
    jsx: 'automatic',
  },
  server: {
    port: 3000,
    open: false,
    proxy: {
      // Proxy API calls to the Node backend on 5000
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 3000,
  },
});
