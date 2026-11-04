import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub project pages are served from /<repository-name>/.
// User/organization pages (username.github.io) and local development use /.
const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
const owner = process.env.GITHUB_REPOSITORY?.split('/')[0];
const isUserSite = repository && owner && repository.toLowerCase() === `${owner.toLowerCase()}.github.io`;
const base = process.env.GITHUB_ACTIONS && repository && !isUserSite ? `/${repository}/` : '/';

export default defineConfig({
  base,
  plugins: [react()],
});
