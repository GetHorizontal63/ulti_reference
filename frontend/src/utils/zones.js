/** Zone classification for normalized throw_y (0 own endzone, 1 scoring). */
export const ZONES = [
  { key: 'own_endzone',      label: 'Own end zone',      range: [0.000, 0.083] },
  { key: 'own_third',        label: 'Own third',         range: [0.083, 0.361] },
  { key: 'midfield',         label: 'Midfield',          range: [0.361, 0.639] },
  { key: 'attacking_third',  label: 'Attacking third',   range: [0.639, 0.917] },
  { key: 'scoring',          label: 'Scoring end zone',  range: [0.917, 1.000] },
];

export function classifyZone(throwY) {
  for (const z of ZONES) {
    const [lo, hi] = z.range;
    if (throwY >= lo && throwY < hi) return z.key;
  }
  return 'scoring';
}

export const PASS_LENGTH_BUCKETS = [
  { key: 'under',    label: 'Under (<10y)',  min: 0,  max: 10 },
  { key: 'short',    label: 'Short (10-20y)', min: 10, max: 20 },
  { key: 'medium',   label: 'Medium (20-40y)', min: 20, max: 40 },
  { key: 'huck',     label: 'Huck (40y+)',    min: 40, max: Infinity },
];

export function classifyPassLength(yards) {
  for (const b of PASS_LENGTH_BUCKETS) {
    if (yards >= b.min && yards < b.max) return b.key;
  }
  return 'huck';
}
