/**
 * Deterministic detection of external integrations, environment variables and the
 * data layer (SPEC §5.4). Everything is found in stored files and import edges;
 * nothing from the repository is executed.
 */

export type IntegrationKind =
  | 'database'
  | 'cache'
  | 'queue'
  | 'payments'
  | 'email'
  | 'auth'
  | 'ai'
  | 'storage'
  | 'search'
  | 'monitoring'
  | 'messaging'
  | 'cms';

/** Known packages, grouped into the service they talk to. Unknown packages are libraries, not integrations. */
const CATALOG: Record<string, { name: string; kind: IntegrationKind }> = {};
function add(kind: IntegrationKind, name: string, packages: string[]) {
  for (const p of packages) CATALOG[p] = { name, kind };
}
add('database', 'Prisma', ['@prisma/client', 'prisma']);
add('database', 'PostgreSQL', ['pg', 'postgres', '@neondatabase/serverless', '@vercel/postgres']);
add('database', 'MySQL', ['mysql', 'mysql2', '@planetscale/database']);
add('database', 'SQLite', ['sqlite3', 'better-sqlite3', '@libsql/client']);
add('database', 'MongoDB', ['mongodb', 'mongoose']);
add('database', 'Drizzle ORM', ['drizzle-orm']);
add('database', 'TypeORM', ['typeorm']);
add('database', 'Sequelize', ['sequelize']);
add('database', 'Knex', ['knex']);
add('database', 'Supabase', ['@supabase/supabase-js']);
add('database', 'Firebase', ['firebase', 'firebase-admin']);
add('database', 'DynamoDB', ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb']);
add('cache', 'Redis', ['redis', 'ioredis', '@upstash/redis', '@redis/client']);
add('cache', 'Memcached', ['memcached', 'memjs']);
add('queue', 'BullMQ', ['bullmq', 'bull']);
add('queue', 'Kafka', ['kafkajs']);
add('queue', 'RabbitMQ', ['amqplib']);
add('queue', 'AWS SQS', ['@aws-sdk/client-sqs']);
add('payments', 'Stripe', ['stripe', '@stripe/stripe-js', '@stripe/react-stripe-js']);
add('payments', 'PayPal', ['@paypal/checkout-server-sdk', '@paypal/react-paypal-js']);
add('payments', 'Lemon Squeezy', ['@lemonsqueezy/lemonsqueezy.js']);
add('email', 'Nodemailer', ['nodemailer']);
add('email', 'Postmark', ['postmark']);
add('email', 'SendGrid', ['@sendgrid/mail']);
add('email', 'Resend', ['resend']);
add('email', 'Mailgun', ['mailgun.js', 'mailgun-js']);
add('auth', 'NextAuth', [
  'next-auth',
  '@auth/core',
  '@next-auth/prisma-adapter',
  '@auth/prisma-adapter',
]);
add('auth', 'Passport', ['passport', 'passport-local', 'passport-jwt', 'passport-google-oauth20']);
add('auth', 'JSON Web Tokens', ['jsonwebtoken', 'jose', 'express-jwt', '@fastify/jwt']);
add('auth', 'Clerk', ['@clerk/nextjs', '@clerk/clerk-sdk-node', '@clerk/express']);
add('auth', 'Auth0', ['@auth0/nextjs-auth0', 'auth0']);
add('auth', 'Password hashing', ['bcrypt', 'bcryptjs', 'argon2', '@node-rs/argon2']);
add('ai', 'OpenAI', ['openai', '@ai-sdk/openai']);
add('ai', 'Anthropic', ['@anthropic-ai/sdk', '@ai-sdk/anthropic']);
add('ai', 'Google Gemini', ['@google/generative-ai', '@google/genai', '@ai-sdk/google']);
add('ai', 'LangChain', ['langchain', '@langchain/core', '@langchain/openai']);
add('ai', 'Vercel AI SDK', ['ai']);
add('storage', 'AWS S3', ['@aws-sdk/client-s3', 'aws-sdk']);
add('storage', 'Cloudinary', ['cloudinary']);
add('storage', 'UploadThing', ['uploadthing']);
add('storage', 'Google Cloud Storage', ['@google-cloud/storage']);
add('search', 'Elasticsearch', ['@elastic/elasticsearch']);
add('search', 'Algolia', ['algoliasearch']);
add('search', 'Meilisearch', ['meilisearch']);
add('monitoring', 'Sentry', ['@sentry/node', '@sentry/nextjs', '@sentry/react', '@sentry/browser']);
add('monitoring', 'Datadog', ['dd-trace']);
add('monitoring', 'Vercel Analytics', ['@vercel/analytics']);
add('monitoring', 'OpenTelemetry', ['@opentelemetry/api', '@opentelemetry/sdk-node']);
add('messaging', 'Twilio', ['twilio']);
add('messaging', 'Slack', ['@slack/web-api', '@slack/bolt']);
add('messaging', 'Pusher', ['pusher', 'pusher-js']);
add('messaging', 'Socket.IO', ['socket.io', 'socket.io-client']);
add('cms', 'Contentlayer', ['contentlayer', 'next-contentlayer']);
add('cms', 'Sanity', ['@sanity/client', 'next-sanity']);
add('cms', 'Contentful', ['contentful']);

export function lookupIntegration(packageName: string) {
  return CATALOG[packageName] ?? null;
}

export interface Evidence {
  file: string;
  line: number;
}

export interface ExternalImport {
  file: string;
  line: number;
  packageName: string;
}

export interface DetectedIntegration {
  /** Service name ("Stripe"); also the node id on the architecture map. */
  name: string;
  kind: IntegrationKind;
  packages: string[];
  /** Import sites; empty when the package is only declared in package.json. */
  imports: (Evidence & { packageName: string })[];
  declaredIn: string[];
}

/**
 * Integrations from import sites of known packages, plus known packages declared as
 * dependencies in any package.json (a dependency can be used only through config, as
 * with Prisma or Contentlayer).
 */
export function detectIntegrations(
  imports: readonly ExternalImport[],
  packageJsons: readonly { path: string; content: string }[],
): DetectedIntegration[] {
  const byName = new Map<string, DetectedIntegration>();
  const entry = (packageName: string) => {
    const known = lookupIntegration(packageName);
    if (!known) return null;
    const existing = byName.get(known.name) ?? {
      name: known.name,
      kind: known.kind,
      packages: [],
      imports: [],
      declaredIn: [],
    };
    if (!existing.packages.includes(packageName)) existing.packages.push(packageName);
    byName.set(known.name, existing);
    return existing;
  };

  for (const imp of imports) {
    entry(imp.packageName)?.imports.push({
      file: imp.file,
      line: imp.line,
      packageName: imp.packageName,
    });
  }
  for (const { path, content } of packageJsons) {
    for (const dependency of declaredDependencies(content)) {
      const found = entry(dependency);
      if (found && !found.declaredIn.includes(path)) found.declaredIn.push(path);
    }
  }
  return [...byName.values()].sort(
    (a, b) => b.imports.length - a.imports.length || a.name.localeCompare(b.name),
  );
}

function declaredDependencies(content: string): string[] {
  try {
    const json = JSON.parse(content) as Record<string, unknown>;
    return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(
      (field) => {
        const deps = json[field];
        return deps && typeof deps === 'object' ? Object.keys(deps) : [];
      },
    );
  } catch {
    return [];
  }
}

const ENV_PATTERNS = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[\s*['"`]([A-Z_][A-Z0-9_]*)['"`]\s*\]/g,
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
];

export interface EnvVar {
  name: string;
  /** Up to five places it is read. */
  usages: Evidence[];
  count: number;
}

/** Environment variables read with process.env / import.meta.env. */
export function detectEnvVars(files: readonly { path: string; content: string }[]): EnvVar[] {
  const found = new Map<string, EnvVar>();
  for (const { path, content } of files) {
    for (const pattern of ENV_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        const name = match[1]!;
        const env = found.get(name) ?? { name, usages: [], count: 0 };
        env.count++;
        if (env.usages.length < 5)
          env.usages.push({ file: path, line: lineAt(content, match.index) });
        found.set(name, env);
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type DataModelSource = 'prisma' | 'mongoose' | 'typeorm' | 'drizzle' | 'sequelize';

export interface DataModel extends Evidence {
  name: string;
  source: DataModelSource;
}

const MODEL_PATTERNS: { source: DataModelSource; pattern: RegExp; requires?: RegExp }[] = [
  { source: 'mongoose', pattern: /\bmongoose\.model\(\s*['"`]([\w$]+)['"`]/g },
  {
    source: 'typeorm',
    pattern: /@Entity\([^)]*\)\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([\w$]+)/g,
  },
  {
    source: 'drizzle',
    pattern: /\b(?:pgTable|mysqlTable|sqliteTable)\(\s*['"`]([\w$]+)['"`]/g,
  },
  {
    source: 'sequelize',
    pattern: /\.define\(\s*['"`]([\w$]+)['"`]/g,
    requires: /from\s+['"]sequelize['"]|require\(\s*['"]sequelize['"]\s*\)/,
  },
];

/** Models from Prisma schemas and common ORM declarations in code. */
export function detectDataModels(
  files: readonly { path: string; content: string; language: string }[],
): DataModel[] {
  const models: DataModel[] = [];
  for (const { path, content, language } of files) {
    if (language === 'prisma' || path.endsWith('.prisma')) {
      for (const match of content.matchAll(/^[ \t]*model\s+([\w$]+)\s*\{/gm)) {
        models.push({
          name: match[1]!,
          source: 'prisma',
          file: path,
          line: lineAt(content, match.index),
        });
      }
      continue;
    }
    for (const { source, pattern, requires } of MODEL_PATTERNS) {
      if (requires && !requires.test(content)) continue;
      for (const match of content.matchAll(pattern)) {
        models.push({ name: match[1]!, source, file: path, line: lineAt(content, match.index) });
      }
    }
  }
  return models;
}

function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}
