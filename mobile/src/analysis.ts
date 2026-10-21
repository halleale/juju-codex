import { decimalOdds } from './domain.ts';
import type { Pick } from './domain.ts';

export function toAmerican(decimal: number): number {
  if (!Number.isFinite(decimal) || decimal <= 1) throw new Error('Invalid decimal odds');
  return decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1);
}

export function analyzePick(pick: Pick) {
  const probability = pick.probability;
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) throw new Error('Invalid probability');
  const decimal = decimalOdds(pick.american_odds);
  const breakEven = 1 / decimal;
  const ev = probability * decimal - 1;
  const references = pick.analysis?.references ?? [];
  const probabilities = references.map(quote => {
    const implied = 1 / decimalOdds(quote.selection_odds);
    const total = implied + 1 / decimalOdds(quote.opponent_odds);
    return { ...quote, implied_probability: implied, overround: total - 1, calculated_probability: implied / total };
  });
  const sorted = probabilities.map(q => q.calculated_probability).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : null;
  const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-8;
  const evidenceVerified = pick.analysis?.model_id === 'market-consensus-v1'
    && !!pick.analysis?.offering_book_key
    && references.length >= 3 && references.length === pick.reference_books
    && new Set(references.map(q => q.key)).size === references.length
    && references.every(q => q.key !== pick.analysis?.offering_book_key)
    && probabilities.every(q => close(q.calculated_probability, q.no_vig_probability))
    && median !== null && close(median, probability) && close(ev, pick.expected_value);
  return {
    decimal, breakEven, ev, probabilityEdge: probability - breakEven,
    fairOdds: toAmerican(1 / probability),
    minimumDecimal: 1.02 / probability,
    minimumOdds: Math.ceil(toAmerican(1.02 / probability)),
    winProfitPer100: (decimal - 1) * 100,
    references: probabilities, evidenceVerified,
    range: sorted.length ? { low: sorted[0], high: sorted[sorted.length - 1] } : null,
    scenarios: [-0.02, 0, 0.02].map(shift => {
      const p = Math.max(0, Math.min(1, probability + shift));
      return { shift, probability: p, ev: p * decimal - 1 };
    }),
  };
}
