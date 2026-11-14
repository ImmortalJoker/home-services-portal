import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/home-services-portal/',
  plugins: [react()],
  test: { environment: 'jsdom', restoreMocks: true, include: ['tests/**/*.test.{ts,tsx}'] },
});
