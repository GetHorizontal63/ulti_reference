/**
 * Field coordinate utilities. All app coordinates use the normalized
 * attacking-direction system documented in public/data/manifest.json:
 *   throw_x: 0 = left sideline, 1 = right sideline
 *   throw_y: 0 = own end zone (behind thrower), 1 = scoring end zone (ahead)
 */

export const FIELD = {
  // UFA: 80-yard playing surface + 2 × 20-yard end zones = 120 total.
  lengthYards: 120,
  playingSurfaceYards: 80,
  endzoneYards: 20,
  widthYards: 53.3333,
  // Normalized y-fraction occupied by each end zone.
  endzoneFrac: 20 / 120, // 0.16667
};

/**
 * Normalize raw absolute field coordinates to the attacking-direction
 * [0,1] x [0,1] space, given which end the offense attacks.
 */
export function normalizeToAttackingDirection(rawX, rawY, attackingTowardTop) {
  const w = FIELD.widthYards;
  const l = FIELD.lengthYards;
  const x = Math.max(0, Math.min(1, rawX / w));
  const yRaw = Math.max(0, Math.min(1, rawY / l));
  return { x, y: attackingTowardTop ? yRaw : 1 - yRaw };
}
