/**
 * buildPossessions.js
 * Place at: src/utils/buildPossessions.js
 *
 * Chains throws into possessions by matching:
 *   throw[N].receiver_id  === throw[N+1].thrower_id
 *   throw[N].svg_recv_x   === throw[N+1].svg_throw_x
 *   throw[N].svg_recv_y   === throw[N+1].svg_throw_y
 *
 * All three must match. ID alone could collide across possessions;
 * coordinates alone could collide on crowded fields. Together they
 * are unambiguous.
 *
 * Null-thrower rows (pull catches, calahans received) are included
 * in the possession as the first throw but never used as a chain
 * anchor for lookup — they start a possession, they don't continue one.
 *
 * A possession ends when:
 *   - pbp_throw_type is drop | throwaway | stall | callahan | score
 *   - No matching next throw exists
 *
 * Returns: Array of possession objects shaped:
 *   { id, teamId, throws[] }
 */

const CHAIN_BREAKERS = new Set(['drop', 'throwaway', 'stall', 'callahan', 'score']);

export function buildPossessions(throws) {
  if (!throws || throws.length === 0) return [];

  // Build lookup: "thrower_id|svg_throw_x,svg_throw_y" -> index
  // Only index rows that have a real thrower (non-null coords + id).
  const originIndex = new Map();
  for (let i = 0; i < throws.length; i++) {
    const t = throws[i];
    if (t.thrower_id != null && t.svg_throw_x != null && t.svg_throw_y != null) {
      const key = `${t.thrower_id}|${t.svg_throw_x},${t.svg_throw_y}`;
      originIndex.set(key, i);
    }
  }

  const used = new Array(throws.length).fill(false);
  const possessions = [];

  for (let i = 0; i < throws.length; i++) {
    if (used[i]) continue;

    const chain = [];
    let cursor = i;

    while (cursor !== -1 && !used[cursor]) {
      const t = throws[cursor];
      used[cursor] = true;
      chain.push(t);

      // End of possession.
      if (CHAIN_BREAKERS.has(t.pbp_throw_type)) break;

      // No reception coords or receiver — can't continue.
      if (t.svg_recv_x == null || t.svg_recv_y == null || t.receiver_id == null) break;

      // Look for the next throw: receiver becomes thrower at the same spot.
      const nextKey = `${t.receiver_id}|${t.svg_recv_x},${t.svg_recv_y}`;
      const nextIdx = originIndex.get(nextKey);
      cursor = nextIdx !== undefined && !used[nextIdx] ? nextIdx : -1;
    }

    if (chain.length > 0) {
      possessions.push({
        id: possessions.length,
        teamId: chain[0].team_id ?? null,
        throws: chain,
      });
    }
  }

  return possessions;
}