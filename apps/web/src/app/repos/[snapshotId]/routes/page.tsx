import { routeListResponseSchema } from '@codebase-copilot/shared';
import { RouteTrace } from '@/components/route-trace';
import { serverApi } from '@/lib/server-api';

export default async function RoutesPage(props: PageProps<'/repos/[snapshotId]/routes'>) {
  const [{ snapshotId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const result = await serverApi(`/api/snapshots/${snapshotId}/routes`, routeListResponseSchema);
  if (!result.ok) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">{result.error}</p>;
  }
  const route = typeof searchParams.route === 'string' ? searchParams.route : null;
  return <RouteTrace snapshotId={snapshotId} routes={result.data.routes} initialRouteId={route} />;
}
