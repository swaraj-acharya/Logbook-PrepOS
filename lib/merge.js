/*
 * Merging two copies of one data file (this browser vs. the stored copy).
 * Month files are merged item by item, review memory per concept, prompts per concept.
 * Anything else: the copy with the later updatedAt wins.
 */
const stamp = x => (x && (x.updatedAt || x.at || x.createdAt)) || 0;

export function unionById(newer, older) {
  const out = newer.slice(), idx = new Map(out.map((x, i) => [x && x.id, i]));
  for (const x of older) {
    if (!x || x.id == null) continue;
    if (!idx.has(x.id)) { idx.set(x.id, out.length); out.push(x); continue; }
    const i = idx.get(x.id);
    if (stamp(x) > stamp(out[i])) out[i] = x;
  }
  return out;
}

function betterMem(a, b) {
  if (!a) return b; if (!b) return a;
  if ((a.reps || 0) !== (b.reps || 0)) return (a.reps || 0) > (b.reps || 0) ? a : b;
  return (a.last || 0) >= (b.last || 0) ? a : b;
}

export function mergeDoc(id, local, remote) {
  if (!local) return remote || null;
  if (!remote) return local;
  const localNewer = (local.updatedAt || 0) >= (remote.updatedAt || 0);
  const newer = localNewer ? local : remote, older = localNewer ? remote : local;
  const updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
  if (/^(ses|rev|mis|tb)-/.test(id)) {
    const out = Object.assign({}, newer, { updatedAt });
    for (const f of ['sessions', 'reviews', 'practice', 'items']) {
      if (Array.isArray(newer[f]) || Array.isArray(older[f])) out[f] = unionById(newer[f] || [], older[f] || []);
    }
    return out;
  }
  if (id.startsWith('pr-')) {
    return Object.assign({}, newer, { updatedAt, byConcept: Object.assign({}, older.byConcept || {}, newer.byConcept || {}) });
  }
  if (id === 'core') {
    const mem = Object.assign({}, older.mem || {});
    for (const k in newer.mem || {}) mem[k] = betterMem(newer.mem[k], mem[k]);
    return Object.assign({}, newer, { updatedAt, mem });
  }
  return newer;
}

/* True when merging changed something relative to `base` (so it needs saving). */
export function differs(a, b) { return JSON.stringify(a) !== JSON.stringify(b); }
