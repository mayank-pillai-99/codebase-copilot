import type { TarEntry } from './tar';

/** A small Express + TypeScript service used by the indexing tests. */
export const fixtureRepo: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'payments-api', dependencies: { express: '^5.0.0' } }),
  'tsconfig.json': `{
    // path alias used by src/server.ts
    "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } },
  }`,
  'README.md': '# Payments API\n\nCharges customers.',
  'src/server.ts': `import express from 'express';
import { paymentsRouter } from '@/routes/payments';

const app = express();
app.use('/api', paymentsRouter);
app.get('/health', (req, res) => res.json({ ok: true }));
app.listen(3000);
`,
  'src/routes/payments.ts': `import { Router } from 'express';
import { createPayment, listPayments } from '../controllers/payments.controller';

export const paymentsRouter = Router();
paymentsRouter.post('/payments', createPayment);
paymentsRouter.get('/payments', listPayments);
`,
  'src/controllers/payments.controller.ts': `import { PaymentService } from '../services/payment.service';

/** Handles POST /payments. */
export async function createPayment(req, res) {
  const service = PaymentService.create();
  res.json(await service.charge(req.body.amount));
}

export function listPayments(req, res) {
  res.json([]);
}
`,
  'src/services/payment.service.ts': `export class PaymentService {
  static create() {
    return new PaymentService();
  }

  async charge(amount: number) {
    this.validate(amount);
    return { amount };
  }

  private validate(amount: number) {
    if (amount <= 0) throw new Error('invalid amount');
  }
}
`,
  // Everything below should be skipped.
  'node_modules/express/index.js': 'module.exports = {}',
  'dist/server.js': 'console.log(1)',
  'package-lock.json': '{}',
  'public/logo.png': 'not really a png',
};

export function fixtureEntries(files: Record<string, string> = fixtureRepo): TarEntry[] {
  return Object.entries(files).map(([path, content]) => ({ path, content }));
}
