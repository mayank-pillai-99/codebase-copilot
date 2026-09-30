import { guideResponseSchema, snapshotResponseSchema } from '@codebase-copilot/shared';
import { SnapshotView } from '@/components/snapshot-view';
import { serverApi } from '@/lib/server-api';

export default async function SnapshotGuidePage(props: PageProps<'/repos/[snapshotId]'>) {
  const { snapshotId } = await props.params;
  // The layout has already checked access and handled 404s.
  const result = await serverApi(`/api/snapshots/${snapshotId}`, snapshotResponseSchema);
  if (!result.ok) return null;
  const guide =
    result.data.snapshot.status === 'READY'
      ? await serverApi(`/api/snapshots/${snapshotId}/guide`, guideResponseSchema)
      : null;

  return (
    <SnapshotView
      initial={result.data.snapshot}
      initialGuide={guide?.ok ? guide.data.guide : null}
    />
  );
}
