export type Pick = {
  id: string;
  matchup: string;
  selection: string;
  book: string;
  american_odds: number;
  probability: number;
  expected_value: number;
  reference_books: number;
  commence_time: string;
  updated_at: string;
};

export type Feed = {
  source: 'demo' | 'live';
  generated_at: string;
  methodology: string;
  picks: Pick[];
};

export type Result = 'won' | 'lost' | 'push';
export type Bet = {
  id: number;
  pick_id: string;
  matchup: string;
  selection: string;
  book: string;
  american_odds: number;
  stake: number;
  source: 'demo' | 'live';
  status: 'pending' | Result;
  profit: number;
};

export function decimalOdds(american: number): number {
  if (!Number.isFinite(american) || Math.abs(american) < 100) throw new Error('Invalid American odds');
  return 1 + (american > 0 ? american / 100 : 100 / -american);
}

export function validateStake(stake: number): void {
  if (!Number.isFinite(stake) || stake <= 0 || stake > 10000) {
    throw new Error('Enter a stake greater than 0 and at most 10,000 units.');
  }
}

export function trackDemo(bets: Bet[], pick: Pick, stake: number): Bet[] {
  validateStake(stake);
  if (bets.some(bet => bet.pick_id === pick.id)) throw new Error('This recommendation is already tracked.');
  if (Date.parse(pick.commence_time) <= Date.now()) throw new Error('This event has started. Refresh picks.');
  return [{
    id: Math.max(0, ...bets.map(b => b.id)) + 1, pick_id: pick.id,
    matchup: pick.matchup, selection: pick.selection, book: pick.book,
    american_odds: pick.american_odds, stake, source: 'demo', status: 'pending', profit: 0,
  }, ...bets];
}

export function settleDemo(bets: Bet[], id: number, result: Result): Bet[] {
  const bet = bets.find(item => item.id === id);
  if (!bet) throw new Error('Tracked pick not found.');
  if (bet.status !== 'pending') throw new Error('This pick is already settled.');
  if (!['won', 'lost', 'push'].includes(result)) throw new Error('Invalid result.');
  return bets.map(item => item.id === id ? {
    ...item, status: result,
    profit: result === 'won' ? item.stake * (decimalOdds(item.american_odds) - 1) : result === 'lost' ? -item.stake : 0,
  } : item);
}

export function summary(bets: Bet[]) {
  const settled = bets.filter(bet => bet.status !== 'pending');
  const profit = settled.reduce((total, bet) => total + bet.profit, 0);
  const staked = settled.reduce((total, bet) => total + bet.stake, 0);
  return { profit, roi: staked ? profit / staked : null, pending: bets.length - settled.length };
}

export function demoFeed(): Feed {
  const now = new Date();
  // A date-based ID keeps refreshes stable but permits a fresh fictional example each day.
  const day = now.toISOString().slice(0, 10);
  const probability = 11 / 23;
  return {
    source: 'demo', generated_at: now.toISOString(),
    methodology: 'Illustrative consensus from three other books. Fictional odds; not a real recommendation.',
    picks: [{
      id: `offline-demo-${day}`, matchup: 'Buffalo Bills at Kansas City Chiefs',
      selection: 'Buffalo Bills', book: 'Demo A', american_odds: 120,
      probability, expected_value: probability * decimalOdds(120) - 1,
      reference_books: 3, commence_time: new Date(now.getTime() + 2 * 86400000).toISOString(),
      updated_at: now.toISOString(),
    }],
  };
}
