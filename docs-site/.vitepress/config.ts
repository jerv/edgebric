import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Edgebric Docs',
  description: 'Documentation for Edgebric — private knowledge platform',
  lang: 'en-US',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo-light.svg' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap', rel: 'stylesheet' }],
  ],

  themeConfig: {
    logo: {
      light: '/logo-light.svg',
      dark: '/logo-dark.svg',
    },

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/api/agent-api' },
      { text: 'Admin', link: '/admin/auth' },
      { text: 'Contributing', link: '/contributing/development' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Installation & First Run', link: '/guide/getting-started' },
            { text: 'Choosing Models', link: '/guide/models' },
          ],
        },
        {
          text: 'Using Edgebric',
          items: [
            { text: 'Data Sources', link: '/guide/data-sources' },
            { text: 'Cloud Sync', link: '/guide/cloud-sync' },
            { text: 'Asking Questions', link: '/guide/querying' },
            { text: 'Group Chats', link: '/guide/group-chats' },
            { text: 'Tools', link: '/guide/tools' },
          ],
        },
        {
          text: 'Advanced',
          items: [
            { text: 'Mesh Networking', link: '/guide/mesh' },
            { text: 'Privacy Modes', link: '/guide/privacy' },
            { text: 'Family Setup', link: '/guide/family-setup' },
          ],
        },
      ],

      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Agent API', link: '/api/agent-api' },
            { text: 'OpenClaw Skill', link: '/api/openclaw' },
            { text: 'Webhooks', link: '/api/webhooks' },
          ],
        },
      ],

      '/admin/': [
        {
          text: 'Administration',
          items: [
            { text: 'Authentication Setup', link: '/admin/auth' },
            { text: 'Users & Roles', link: '/admin/users' },
            { text: 'Security', link: '/admin/security' },
            { text: 'Integrations', link: '/admin/integrations' },
          ],
        },
      ],

      '/contributing/': [
        {
          text: 'Contributing',
          items: [
            { text: 'Development Setup', link: '/contributing/development' },
            { text: 'Testing', link: '/contributing/testing' },
            { text: 'Architecture', link: '/contributing/architecture' },
            { text: 'Adding Integrations', link: '/contributing/adding-integrations' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/jerv/edgebric' },
    ],

    editLink: {
      pattern: 'https://github.com/jerv/edgebric/edit/main/docs-site/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the AGPL-3.0 License.',
      copyright: 'Copyright 2026-present Edgebric',
    },
  },

  appearance: 'dark',

  sitemap: {
    hostname: 'https://docs.edgebric.com',
  },
})
