import { decimalOdds } from './domain.ts';
import type { Pick } from './domain.ts';

export type HistoryPoint = {
  timestamp: string;
  american_odds: number;
  no_vig_probability: number | null;
  observed_at: string;
};

export type ResearchSection = {
  topic: string;
  title: string;
  status: 'reported' | 'uncertain' | 'unavailable';
  beginner: string;
  advanced: string;
  as_of: string | null;
  metrics: { label: string; value: string; period: string; sample_size: number | null }[];
  source_ids: string[];
};

export type ResearchReport = {
  status: 'demo' | 'needs_config' | 'not_requested' | 'ready';
  source: 'demo' | 'live';
  generated_at: string | null;
  model: string | null;
  cached?: boolean;
  timeline: {
    status: 'collecting' | 'available';
    simulated: boolean;
    label: string;
    probability_change: number | null;
    best_odds: number | null;
    points: HistoryPoint[];
  };
  sections: ResearchSection[];
  sources: { id: string; title: string; url: string }[];
};

export function describeTrend(points: HistoryPoint[]) {
  if (points.length < 2) return { headline: 'Collecting price history', change: null };
  const change = 1 / decimalOdds(points[points.length - 1].american_odds) - 1 / decimalOdds(points[0].american_odds);
  return {
    headline: Math.abs(change) < 1e-10 ? 'No net price change in this window'
      : change < 0 ? 'The payout improved in this window' : 'The payout shortened in this window',
    change,
  };
}

export function demoResearch(pick: Pick): ResearchReport {
  const now = Date.now();
  const points = [105, 110, 115, pick.american_odds].map((price, i) => ({
    timestamp: new Date(now - 6 * (3 - i) * 3600000).toISOString(), american_odds: price,
    no_vig_probability: null, observed_at: new Date(now).toISOString(),
  }));
  const prompts = [
    ['team_form', 'Team form & efficiency', 'Compare team performance over a stated period.', 'Look for opponent-adjusted efficiency, offensive/defensive splits and sample size; a record alone is not a forecast.'],
    ['injuries', 'Injuries & availability', 'Check the latest official player availability report.', 'Confirm report time, practice status and starting roles. Do not assume an injury causes a price move.'],
    ['weather', 'Weather & venue', 'Check kickoff-time weather and whether the venue has a roof.', 'Wind, precipitation, venue and forecast uncertainty matter. No weather measurement has been retrieved for this fictional game.'],
    ['situational', 'Rest, travel & matchup context', 'Check rest days, travel and schedule context.', 'Compare each team consistently; look for confounders rather than cherry-picking a favorable trend.'],
    ['historical', 'Historical statistics & similar situations', 'Ask how many games support a historical trend.', 'Require the date range, sample size and selection criteria. Small situational samples can overfit and may have no predictive value.'],
  ];
  return {
    status: 'demo', source: 'demo', generated_at: new Date(now).toISOString(), model: null,
    timeline: { status: 'available', simulated: true, label: 'Illustrative price history',
      probability_change: describeTrend(points).change, best_odds: Math.max(...points.map(p => p.american_odds)), points },
    sections: prompts.map(([topic, title, beginner, advanced]) => ({
      topic, title, beginner, advanced, status: 'unavailable', as_of: null, metrics: [], source_ids: [],
    })), sources: [],
  };
}
