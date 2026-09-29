import { getCurrentUser } from '@/lib/session';
import { HeaderNav } from './header-nav';

export async function SiteHeader() {
  const user = await getCurrentUser();
  return <HeaderNav email={user?.email ?? null} />;
}
