export type RepoSectionId =
  'guide' | 'architecture' | 'insights' | 'impact' | 'routes' | 'code' | 'chat';

export interface RepoSection {
  id: RepoSectionId;
  href: string;
  label: string;
}

/** The sections of a repository workspace, in navigation order. */
export function repoSections(snapshotId: string): RepoSection[] {
  const base = `/repos/${snapshotId}`;
  return [
    { id: 'guide', href: base, label: 'Guide' },
    { id: 'architecture', href: `${base}/architecture`, label: 'Architecture' },
    { id: 'insights', href: `${base}/insights`, label: 'Insights' },
    { id: 'impact', href: `${base}/impact`, label: 'Impact' },
    { id: 'routes', href: `${base}/routes`, label: 'Routes' },
    { id: 'code', href: `${base}/code`, label: 'Code' },
    { id: 'chat', href: `${base}/chat`, label: 'Chat' },
  ];
}

/** The section a pathname belongs to. The guide is the bare repository path only. */
export function activeSection(snapshotId: string, pathname: string): RepoSectionId | null {
  const base = `/repos/${snapshotId}`;
  if (pathname === base || pathname === `${base}/`) return 'guide';
  return (
    repoSections(snapshotId).find(
      (s) => s.id !== 'guide' && (pathname === s.href || pathname.startsWith(`${s.href}/`)),
    )?.id ?? null
  );
}
