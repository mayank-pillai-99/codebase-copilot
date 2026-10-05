import { expect, test, type APIRequestContext } from '@playwright/test';

/** The seeded demo snapshot (apps/api/scripts/seed-e2e.ts). */
async function demoSnapshot(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/demo');
  expect(res.ok()).toBe(true);
  const { repositories } = (await res.json()) as {
    repositories: { name: string; latestSnapshot: { id: string } }[];
  };
  const demo = repositories.find((r) => r.name === 'payments-api');
  expect(demo, 'the e2e demo repository is seeded').toBeDefined();
  return demo!.latestSnapshot.id;
}

test.describe('demo repository', () => {
  let snapshot = '';
  test.beforeAll(async ({ request }) => {
    snapshot = await demoSnapshot(request);
  });

  test('opens from the landing page on the onboarding guide', async ({ page }) => {
    await page.goto('/');
    await page.locator('#demos a', { hasText: 'payments-api' }).click();
    await expect(page).toHaveURL(new RegExp(`/repos/${snapshot}$`));
    await expect(page.getByText('About this codebase')).toBeVisible();
    await expect(page.getByText('Express').first()).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('traces a route through the call graph', async ({ page }) => {
    await page.goto(`/repos/${snapshot}/routes`);
    await page.getByRole('button', { name: /POST\s+\/payments$/ }).click();
    await expect(page.getByText('PaymentService.create').first()).toBeVisible();
  });

  test('finds a function with ⌘K and shows its references', async ({ page }) => {
    await page.goto(`/repos/${snapshot}`);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.type('createPayment');
    await expect(
      page.getByRole('option').filter({ hasText: 'payments.controller.ts:' }).first(),
    ).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/code\?path=src%2Fcontrollers%2Fpayments\.controller\.ts/);

    const references = page.locator('aside', { hasText: 'References' });
    await expect(references.getByText('createPayment').first()).toBeVisible();
    await expect(references.getByText('/payments')).toBeVisible();
    await expect(references.getByText('PaymentService.create')).toBeVisible();
  });

  test('shows what a change can affect', async ({ page }) => {
    await page.goto(`/repos/${snapshot}/code?path=src/services/payment.service.ts&lines=3`);
    await page.getByRole('link', { name: /What depends on this/ }).click();
    await expect(page).toHaveURL(/\/impact\?/);
    await expect(page.getByText(/Changing it reaches 1 route/)).toBeVisible();
    await expect(page.getByText('createPayment').first()).toBeVisible();
  });

  test('computes insights without AI', async ({ page }) => {
    await page.goto(`/repos/${snapshot}/insights`);
    await expect(page.getByText('Most-called functions')).toBeVisible();
    await expect(page.getByText('Riskiest file to change')).toBeVisible();
  });

  test('fits a phone screen without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const tab of [
      '',
      '/architecture',
      '/insights',
      '/routes',
      '/impact',
      '/code?path=src/server.ts',
    ]) {
      await page.goto(`/repos/${snapshot}${tab}`);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `overflow on ${tab || 'guide'}`).toBeLessThanOrEqual(0);
    }
  });
});

test('creates an account and signs in', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/repos$/);
  await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible();
});

test.describe('security', () => {
  test('sends anti-framing and MIME-sniffing headers', async ({ request }) => {
    const res = await request.get('/');
    expect(res.headers()['x-frame-options']).toBe('DENY');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  test('hides snapshots that are neither tracked nor demos', async ({ request }) => {
    const res = await request.get('/api/snapshots/00000000-0000-4000-8000-000000000000');
    expect(res.status()).toBe(404);
  });

  test('requires sign-in to add a repository', async ({ request }) => {
    const res = await request.post('/api/repos', { data: { url: 'https://github.com/a/b' } });
    expect(res.status()).toBe(401);
  });
});
