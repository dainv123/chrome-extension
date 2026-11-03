import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: 'dist',
  manifest: {
    name: 'Quiet',
    description: 'One click: calm reading mode. No ads, no clutter, no setup.',
    version: '0.1.0',
    permissions: ['activeTab', 'contextMenus', 'scripting'],
    action: {
      default_title: 'Quiet — read this page',
    },
  },
});
