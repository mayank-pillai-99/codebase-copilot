import { impactResponseSchema, insightsResponseSchema } from '@codebase-copilot/shared';
import { ImpactStart, ImpactView } from '@/components/impact-view';
import { serverApi } from '@/lib/server-api';

export default async function ImpactPage(props: PageProps<'/repos/[snapshotId]/impact'>) {
  const [{ snapshotId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const path = typeof searchParams.path === 'string' ? searchParams.path : null;
  const line = typeof searchParams.line === 'string' ? Number(searchParams.line) : NaN;

  if (!path || !Number.isInteger(line) || line < 1) {
    // The layout has already checked access; 409 means indexing hasn't finished.
    const insights = await serverApi(
      `/api/snapshots/${snapshotId}/insights`,
      insightsResponseSchema,
    );
    if (!insights.ok) return <Notice>{notice(insights.status, insights.error)}</Notice>;
    return <ImpactStart snapshotId={snapshotId} mostCalled={insights.data.insights.mostCalled} />;
  }

  const result = await serverApi(
    `/api/snapshots/${snapshotId}/impact?${new URLSearchParams({ path, line: String(line) })}`,
    impactResponseSchema,
  );
  if (!result.ok) return <Notice>{notice(result.status, result.error)}</Notice>;
  if (!result.data.symbol) {
    return (
      <Notice>
        Line {line} of {path} isn&apos;t inside a function, method or class.
      </Notice>
    );
  }
  return <ImpactView snapshotId={snapshotId} impact={result.data} />;
}

const notice = (status: number, error: string) =>
  status === 409 ? 'Impact analysis is available once indexing finishes.' : error;

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-600 dark:text-zinc-400">{children}</p>;
}
