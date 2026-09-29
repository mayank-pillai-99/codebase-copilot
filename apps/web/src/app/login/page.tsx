import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { safeNextPath } from '@/lib/redirect';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Log in · Codebase Copilot' };

export default async function LoginPage(props: PageProps<'/login'>) {
  const next = safeNextPath((await props.searchParams).next);
  if (await getCurrentUser()) redirect(next);

  return (
    <main className="px-4 py-16 sm:py-24">
      <AuthForm mode="login" next={next} />
    </main>
  );
}
