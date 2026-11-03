/** File snapshots are content-addressed; groups may contain other groups. */
export interface HistoryChange { file: string; before: string | null; after: string | null }
export interface HistoryGroup { label: string; changes?: HistoryChange[]; children?: HistoryGroup[] }
export interface HistoryNode {
  id: string; parent: string | null; label: string; at: string;
  group: HistoryGroup; files: Record<string, string>;
  git?: { sha: string; subject: string };
}
export interface HistoryState { version: 1; revision: number; cursor: string; nodes: HistoryNode[] }
export interface HistoryView {
  revision: number; cursor: string; canUndo: boolean; redo: string[];
  nodes: Array<Omit<HistoryNode, 'files' | 'group'> & { files: string[]; depth: number }>;
}
export function flattenGroup(group: HistoryGroup): HistoryChange[] {
  return [...(group.changes ?? []), ...(group.children ?? []).flatMap(flattenGroup)];
}
