import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile(), {
    name: 'offline-production-policy',
    transformIndexHtml(html, context) {
      return context.server ? html : html.replace("connect-src 'self' ws://127.0.0.1:*", "connect-src 'none'");
    },
  }],
  base: './',
  build: { target: 'es2022', reportCompressedSize: true },
});
