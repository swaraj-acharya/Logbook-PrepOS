export type DocBody = Record<string, unknown>;
export type StoredDoc = { body: DocBody; sha: string };
export type DocMap = Record<string, StoredDoc>;
/** body null deletes the file. baseSha is the version the browser last saw (null if it never saw one). */
export type Change = { body: DocBody | null; baseSha: string | null };
export type ApplyResult = {
  saved: Record<string, string | null>;
  conflicts: Record<string, { body: DocBody | null; sha: string | null }>;
};
export interface DocStore {
  readonly label: string;
  loadAll(uid: string): Promise<DocMap>;
  apply(uid: string, changes: Record<string, Change>): Promise<ApplyResult>;
}
export class StoreError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
export const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const UID = /^[A-Za-z0-9_-]{1,64}$/;
