// =============================================================================
// api/analyze/strategies/sharedStructure.js
// Shared structure helpers for strategy analysis.
// =============================================================================

import { safeNum } from './sharedMath.js';

export function sameOptionType(legs) {
  const types = [...new Set((legs || []).map(l => String(l.t || '').toUpperCase()).filter(Boolean))];
  return types.length <= 1 ? types[0] || null : null;
}

export function groupedByStrike(legs) {
  const map = new Map();
  for (const leg of legs) {
    const strike = safeNum(leg.s);
    if (!strike) continue;
    const item = map.get(strike) || { strike, buyQty: 0, sellQty: 0, netQty: 0 };
    const qty = Math.max(1, safeNum(leg.n || 1, 1));
    if (leg.a === 'BUY') item.buyQty += qty;
    if (leg.a === 'SELL') item.sellQty += qty;
    item.netQty = item.buyQty - item.sellQty;
    map.set(strike, item);
  }
  return [...map.values()].sort((a, b) => a.strike - b.strike);
}
