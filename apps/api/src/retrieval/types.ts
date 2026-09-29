export type RetrievalSource = 'vector' | 'fulltext' | 'graph';

export interface RetrievedChunk {
  chunkId: string;
  fileId: string;
  symbolId: string | null;
  path: string;
  kind: string;
  label: string | null;
  startLine: number;
  endLine: number;
  header: string;
  content: string;
  /** Higher is better; comparable only within one retriever's results. */
  score: number;
  /** Which strategies surfaced this chunk. */
  sources: RetrievalSource[];
}

export interface RetrieveInput {
  snapshotId: string;
  query: string;
  k: number;
}

/** Every strategy implements this, so they can be swapped and compared (SPEC §6, §8). */
export interface Retriever {
  readonly name: 'vector' | 'fulltext' | 'hybrid' | 'agentic';
  retrieve(input: RetrieveInput): Promise<RetrievedChunk[]>;
}

/** What retrieval needs from an embedding model. */
export interface QueryEmbedder {
  readonly model: string;
  embedQuery(query: string): Promise<number[]>;
}
