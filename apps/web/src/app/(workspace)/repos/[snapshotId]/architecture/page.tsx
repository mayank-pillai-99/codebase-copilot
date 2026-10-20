import { architectureResponseSchema } from '@codebase-copilot/shared';
import { ArchitectureMap } from '@/components/architecture-map';
import { serverApi } from '@/lib/server-api';

export default async function ArchitecturePage(
  props: PageProps<'/repos/[snapshotId]/architecture'>,
) {
  const { snapshotId } = await props.params;
  // The layout has already checked access; 409 means indexing hasn't finished.
  const result = await serverApi(
    `/api/snapshots/${snapshotId}/architecture`,
    architectureResponseSchema,
  );
  if (!result.ok) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {result.status === 409
          ? 'The architecture map appears once indexing finishes.'
          : result.error}
      </p>
    );
  }
  return <ArchitectureMap snapshotId={snapshotId} architecture={result.data.architecture} />;
}
