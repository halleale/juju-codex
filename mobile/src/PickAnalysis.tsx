import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Pick } from './domain';
import { analyzePick } from './analysis';

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const signed = (value: number, digits = 1) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
const odds = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value)}`;
const date = (value: string) => new Date(value).toLocaleString();

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={s.section}><Text style={s.heading}>{title}</Text>{children}</View>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={s.row}><Text style={[s.body, { flex: 1 }]}>{label}</Text><Text style={s.value}>{value}</Text></View>;
}

function ProbabilityBar({ label, probability, color }: { label: string; probability: number; color: string }) {
  return <View style={{ gap: 7 }} accessible accessibilityLabel={`${label}: ${pct(probability)}`}>
    <Row label={label} value={pct(probability)} />
    <View style={s.track}><View style={{ height: 8, width: `${probability * 100}%`, backgroundColor: color, borderRadius: 4 }} /></View>
  </View>;
}

export default function PickAnalysis({ pick, source, onClose }: {
  pick: Pick; source: 'demo' | 'live'; onClose: () => void;
}) {
  let analysis: ReturnType<typeof analyzePick>;
  try { analysis = analyzePick(pick); }
  catch {
    return <SafeAreaView style={s.safe}><View style={s.content}>
      <Text style={s.title}>Analysis unavailable</Text><Text style={s.body}>These prices could not be verified. Refresh the recommendations before using this pick.</Text>
      <Pressable accessibilityRole="button" onPress={onClose} style={s.close}><Text style={s.closeText}>Back to picks</Text></Pressable>
    </View></SafeAreaView>;
  }
  const first = analysis.references[0];
  return <SafeAreaView style={s.safe}>
    <View style={s.header}>
      <Text style={s.eyebrow}>THE RESEARCH BEHIND THE PRICE</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close pick analysis" onPress={onClose} style={s.close}>
        <Text style={s.closeText}>Done</Text>
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.title}>{pick.selection}</Text>
      <Text style={s.body}>{pick.matchup}</Text>
      <Text style={s.heroPrice}>{odds(pick.american_odds)} <Text style={s.small}>at {pick.book}</Text></Text>
      <View style={s.notice}>
        <Text style={s.noticeTitle}>{source === 'demo' ? 'FICTIONAL DEMO ANALYSIS' : 'MARKET-CONSENSUS ESTIMATE'}</Text>
        <Text style={s.body}>{source === 'demo'
          ? 'Every price and example here is fictional. This demonstrates how a pick is explained; it is not a recommendation for a real game.'
          : 'This screen explains a price difference using sportsbook quotes. It does not establish that this team will win or that the estimate is profitable.'}</Text>
      </View>
      <Section title="Why this price was selected">
        <Text style={s.body}>At {odds(pick.american_odds)}, this selection needs to win {pct(analysis.breakEven)} of the time to break even. The reported market-consensus estimate is {pct(pick.probability)}—a difference of {signed(analysis.probabilityEdge * 100)} percentage points.</Text>
        <Text style={s.body}>That produces {signed(analysis.ev * 100)}% estimated expected value, {analysis.ev >= .02 ? 'meeting' : 'falling below'} the 2% selection threshold. {pick.reference_books} other books are reported as references; the offering book is excluded from the estimate.</Text>
        <Text style={s.small}>The selection is about the available price. A team can have less than a 50% estimated win probability and still offer estimated positive value.</Text>
        <ProbabilityBar label="Break-even probability at this price" probability={analysis.breakEven} color="#869BB3" />
        <ProbabilityBar label="Estimated consensus probability" probability={pick.probability} color="#6CF2B1" />
      </Section>
      <Section title="Price, payout & expected return">
        <Row label="Offered moneyline" value={odds(pick.american_odds)} />
        <Row label="Offered decimal odds" value={analysis.decimal.toFixed(3)} />
        <Row label="Estimated fair moneyline" value={`≈ ${odds(analysis.fairOdds)}`} />
        <Row label="Minimum moneyline for 2% est. EV" value={odds(analysis.minimumOdds)} />
        <Text style={s.small}>The minimum price is rounded toward a better payout and assumes the same probability estimate. Recalculate if the market changes.</Text>
        <Row label="If a 100-unit stake wins: net profit" value={`${signed(analysis.winProfitPer100, 2)} units`} />
        <Row label="If it loses: net loss" value="−100.00 units" />
        <Row label="Estimated net return per 100 staked" value={`${signed(analysis.ev * 100, 2)} units`} />
        <Text style={s.formula}>{pct(pick.probability)} × {analysis.decimal.toFixed(3)} − 1 = {signed(analysis.ev * 100)}% EV</Text>
        <Text style={s.small}>Expected return is an average implied by the assumed probability, not a promised payout for this game. A push, if applicable, returns the stake. This calculation models two outcomes and does not separately estimate tie or void probabilities.</Text>
      </Section>
      <Section title="The reference-book evidence">
        <Text style={[s.value, { color: analysis.evidenceVerified ? '#6CF2B1' : '#F3CF80' }]}>
          {analysis.evidenceVerified ? 'Calculation reconciles with the supplied quotes' : 'Full evidence has not been verified'}
        </Text>
        {!analysis.references.length && <Text style={s.body}>This feed did not include reference quotes. Update the backend to the latest version to see the supporting prices; the headline estimate alone is not a complete audit trail.</Text>}
        {analysis.references.map(reference => <View key={reference.key} style={s.reference}>
          <Text style={s.heading}>{reference.book}</Text>
          <Row label={pick.selection} value={odds(reference.selection_odds)} />
          <Row label={pick.analysis?.opponent ?? 'Opponent'} value={odds(reference.opponent_odds)} />
          <Row label="Raw implied chance for this pick" value={pct(reference.implied_probability)} />
          <Row label="Market overround" value={pct(reference.overround)} />
          <Row label="After removing margin" value={pct(reference.calculated_probability)} />
          <Text style={s.small}>Quote timestamp · {date(reference.updated_at)}</Text>
        </View>)}
        {analysis.range && <Text style={s.body}>Reference estimates range from {pct(analysis.range.low)} to {pct(analysis.range.high)}. This is the spread between books, not a statistical confidence interval.</Text>}
        {first && <Text style={s.small}>Worked example from {first.book}: implied chance = 1 ÷ decimal odds. Divide that chance by the sum of both sides' implied chances to remove margin. Its normalized estimate is {pct(first.calculated_probability)}. The median across the reference books gives the consensus.</Text>}
        <Text style={s.small}>Verification checks distinct reference books, exclusion of the offering book, the margin-removal calculation, the median, and headline EV. It does not authenticate the provider or validate predictive accuracy.</Text>
      </Section>
      <Section title="How much can the estimate change?">
        <Text style={s.body}>Here is what happens if the assumed win probability is two percentage points lower or higher, with the offered price unchanged.</Text>
        {analysis.scenarios.map(scenario => <View key={scenario.shift} style={s.reference}>
          <Row label={scenario.shift === 0 ? 'Current estimate' : `${scenario.shift > 0 ? '+' : '−'}2 percentage points`} value={pct(scenario.probability)} />
          <Row label="Estimated expected value" value={`${signed(scenario.ev * 100)}%`} />
          <Text style={s.small}>{scenario.ev >= .02 ? 'Meets the 2% screen' : scenario.ev > 0 ? 'Positive estimate, but below the 2% screen' : 'No estimated positive edge'}</Text>
        </View>)}
        <Text style={s.small}>These hypothetical probabilities are bounded between 0% and 100%. They are not predictions, probability bounds, or a confidence score. Small estimation errors can erase the apparent edge.</Text>
      </Section>
      <Section title="What the model uses">
        <Text style={s.heading}>Market consensus · v1</Text>
        <Text style={s.body}>Inputs: pre-game NFL two-sided moneylines, sportsbook identity, and quote timestamps. Normalize each reference book's probabilities, exclude the offering book, and use the median estimate from at least three other books.</Text>
        <Text style={s.body}>Selection rules: estimated EV of at least 2%, kickoff still in the future, and offering/reference quotes no more than 15 minutes old when calculated.</Text>
        <Text style={s.body}>Not included: player injuries, starting lineups, weather, recent team form, efficiency statistics, travel, or historical line movement. There are no independently trained team-performance models in this version.</Text>
        <Text style={s.body}>Validation: no historical calibration, out-of-sample backtest, closing-line evaluation, or demonstrated profitability yet. Book consensus can be correlated or wrong.</Text>
      </Section>
      <Section title="What could invalidate the pick?">
        <Text style={s.body}>• The offered price changes or is unavailable to you.{`\n`}• A quote is stale, or the game has started.{`\n`}• News moves the market after these quotes were captured.{`\n`}• Reference books share the same bias or copy each other's prices.{`\n`}• Sportsbook settlement rules, limits, ties, or voids differ from the two-outcome assumption.</Text>
        <Text style={s.small}>Offered quote · {date(pick.updated_at)}</Text>
        {pick.analysis && <Text style={s.small}>Calculated · {date(pick.analysis.calculated_at)}</Text>}
        <Text style={s.small}>Refresh prices and check your sportsbook before acting. No wager is placed by this app.</Text>
      </Section>
    </ScrollView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#09111D' },
  header: { padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderBottomWidth: 1, borderColor: '#233346' },
  content: { padding: 22, paddingBottom: 40, gap: 18 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: '#6CF2B1', flexShrink: 1 },
  title: { fontSize: 30, fontWeight: '800', color: '#F3F6FC' },
  heroPrice: { fontSize: 36, fontWeight: '700', color: '#6CF2B1' },
  section: { padding: 18, gap: 15, borderRadius: 18, backgroundColor: '#121E2D', borderWidth: 1, borderColor: '#233346' },
  heading: { fontSize: 18, fontWeight: '700', color: '#F3F6FC' },
  body: { fontSize: 14, lineHeight: 22, color: '#D9E5F2' },
  small: { fontSize: 12, lineHeight: 19, color: '#9DACBF' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, justifyContent: 'space-between' },
  value: { fontSize: 14, lineHeight: 22, fontWeight: '700', color: '#D9E5F2', flexShrink: 1 },
  reference: { borderTopWidth: 1, borderColor: '#304052', paddingTop: 14, gap: 9 },
  track: { height: 8, backgroundColor: '#293C50', borderRadius: 4 },
  formula: { fontSize: 14, lineHeight: 22, color: '#6CF2B1', fontVariant: ['tabular-nums'] },
  notice: { padding: 16, gap: 10, borderRadius: 14, backgroundColor: '#29281E', borderWidth: 1, borderColor: '#47422D' },
  noticeTitle: { color: '#F3CF80', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  close: { padding: 12, backgroundColor: '#233346', borderRadius: 10, minHeight: 44 },
  closeText: { color: '#6CF2B1', fontSize: 14, fontWeight: '700' },
});
