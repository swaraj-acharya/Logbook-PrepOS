/*
 * Merging two copies of one data file (this browser vs. the stored copy, another device, or the preparation file).
 * Month files are merged item by item, review memory per concept or question, prompts per concept, lectures and
 * resources per item (deletions travel as tombstones), plan history per day.
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
  if (/^(ses|rev|mis|tb|qs)-/.test(id)) {
    const out = Object.assign({}, newer, { updatedAt });
    for (const f of ['sessions', 'reviews', 'practice', 'qattempts', 'items']) {
      if (Array.isArray(newer[f]) || Array.isArray(older[f])) out[f] = unionById(newer[f] || [], older[f] || []);
    }
    return out;
  }
  if (id.startsWith('pr-')) {
    return Object.assign({}, newer, { updatedAt, byConcept: Object.assign({}, older.byConcept || {}, newer.byConcept || {}) });
  }
  if (id === 'core') {
    const memOf = f => { const m = Object.assign({}, older[f] || {}); for (const k in newer[f] || {}) m[k] = betterMem(newer[f][k], m[k]); return m; };
    const out = Object.assign({}, newer, { updatedAt, mem: memOf('mem') });
    if (newer.qmem || older.qmem) out.qmem = memOf('qmem');
    for (const f of ['lectures', 'resources']) if (Array.isArray(newer[f]) || Array.isArray(older[f])) out[f] = unionById(newer[f] || [], older[f] || []);
    if (newer.planHistory || older.planHistory) out.planHistory = Object.assign({}, older.planHistory || {}, newer.planHistory || {});
    return out;
  }
  return newer;
}

/* True when merging changed something relative to `base` (so it needs saving). */
export function differs(a, b) { return JSON.stringify(a) !== JSON.stringify(b); }
