import { routeListResponseSchema, snapshotResponseSchema } from '@codebase-copilot/shared';
import { SnapshotView } from '@/components/snapshot-view';
import { serverApi } from '@/lib/server-api';

export default async function SnapshotOverviewPage(props: PageProps<'/repos/[snapshotId]'>) {
  const { snapshotId } = await props.params;
  // The layout has already checked access and handled 404s.
  const result = await serverApi(`/api/snapshots/${snapshotId}`, snapshotResponseSchema);
  if (!result.ok) return null;
  const routes =
    result.data.snapshot.status === 'READY'
      ? await serverApi(`/api/snapshots/${snapshotId}/routes`, routeListResponseSchema)
      : null;

  return (
    <SnapshotView
      initial={result.data.snapshot}
      initialRoutes={routes?.ok ? routes.data.routes : null}
    />
  );
}
