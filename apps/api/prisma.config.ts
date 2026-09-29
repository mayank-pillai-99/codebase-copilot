import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Local development keeps a single .env at the repo root; CI and deploys set real env vars.
config({ path: '../../.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
  },
});
