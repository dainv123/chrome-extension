import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: 'dist',
  manifest: {
    name: 'ClipKit',
    description: 'Copy clean Markdown + brief with one gesture. Paste into notes.',
    version: '0.4.0',
    permissions: ['activeTab', 'contextMenus', 'scripting', 'sidePanel', 'storage'],
    host_permissions: [
      'http://*/*',
      'https://*/*',
      'https://generativelanguage.googleapis.com/*',
    ],
    action: {
      default_title: 'ClipKit',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    commands: {
      'clip-and-brief': {
        suggested_key: {
          default: 'Alt+Shift+C',
          mac: 'Alt+Shift+C',
        },
        description: 'Clip & Brief current page (copy + download .md)',
      },
    },
  },
});
