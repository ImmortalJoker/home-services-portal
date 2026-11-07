import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/home-services-portal/',
  plugins: [react()],
  test: { environment: 'jsdom', restoreMocks: true },
});
