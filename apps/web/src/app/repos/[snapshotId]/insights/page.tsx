import { insightsResponseSchema } from '@codebase-copilot/shared';
import { InsightsView } from '@/components/insights-view';
import { serverApi } from '@/lib/server-api';

export default async function InsightsPage(props: PageProps<'/repos/[snapshotId]/insights'>) {
  const { snapshotId } = await props.params;
  // The layout has already checked access; 409 means indexing hasn't finished.
  const result = await serverApi(`/api/snapshots/${snapshotId}/insights`, insightsResponseSchema);
  if (!result.ok) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {result.status === 409 ? 'Insights appear once indexing finishes.' : result.error}
      </p>
    );
  }
  return <InsightsView snapshotId={snapshotId} insights={result.data.insights} />;
}
