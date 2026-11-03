import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: 'dist',
  manifest: {
    name: 'JSON Bench',
    description: 'Format JSON and diff two payloads side by side.',
    version: '0.1.0',
    permissions: ['sidePanel'],
    action: {
      default_title: 'JSON Bench',
    },
  },
});
