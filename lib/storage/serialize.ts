import { createHash } from 'node:crypto';

/** Stable, diff-friendly JSON for files in the repository. */
export function serialize(body: unknown): string { return JSON.stringify(body, null, 1) + '\n'; }

/** The id git gives this exact content (same as `git hash-object`). */
export function gitBlobSha(text: string): string {
  const buf = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}
