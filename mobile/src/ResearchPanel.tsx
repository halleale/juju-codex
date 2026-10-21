import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Pick } from './domain';
import { decimalOdds } from './domain';
import { request } from './api';
import { demoResearch, describeTrend } from './research';
import type { HistoryPoint, ResearchReport } from './research';

const odds = (value: number) => `${value > 0 ? '+' : ''}${value}`;
const date = (value: string) => new Date(value).toLocaleString();

function PriceChart({ points }: { points: HistoryPoint[] }) {
  const [width, setWidth] = useState(260);
  const display = points.length <= 25 ? points : points.filter((_, i) => i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 23) === 0);
  if (display.length < 2) return null;
  const values = display.map(point => 1 / decimalOdds(point.american_odds));
  const low = Math.min(...values), high = Math.max(...values);
  const range = Math.max(high - low, .005);
  const coords = values.map((value, i) => ({ x: 8 + i / (values.length - 1) * (width - 16), y: 14 + (high - value) / range * 100 }));
  return <View accessible accessibilityLabel={`Recorded implied chance from ${(values[0] * 100).toFixed(1)} percent to ${(values[values.length - 1] * 100).toFixed(1)} percent`}>
    <View style={s.row}><Text style={s.small}>Implied win probability</Text><Text style={s.small}>{(high * 100).toFixed(1)}% high</Text></View>
    <View style={{ height: 134 }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      {coords.slice(1).map((point, i) => {
        const prev = coords[i], dx = point.x - prev.x, dy = point.y - prev.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        return <View key={`line-${i}`} style={{ position: 'absolute', left: (point.x + prev.x) / 2 - length / 2,
          top: (point.y + prev.y) / 2 - 1, height: 2, width: length, backgroundColor: '#6CF2B1',
          transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }} />;
      })}
      {coords.map((point, i) => <View key={i} style={{ position: 'absolute', left: point.x - 3, top: point.y - 3,
        width: 6, height: 6, borderRadius: 3, backgroundColor: '#6CF2B1' }} />)}
    </View>
    <View style={s.row}><Text style={s.small}>First {odds(display[0].american_odds)}</Text><Text style={s.small}>Latest {odds(display[display.length - 1].american_odds)}</Text></View>
    <Text style={s.small}>Observation order; time intervals may vary. Range {(low * 100).toFixed(1)}–{(high * 100).toFixed(1)}%.</Text>
  </View>;
}

export default function ResearchPanel({ pick, source, apiURL, advanced }: {
  pick: Pick; source: 'demo' | 'live'; apiURL?: string; advanced: boolean;
}) {
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    let cancelled = false;
    active.current = true;
    setError('');
    if (source === 'demo') { setReport(demoResearch(pick)); return () => { active.current = false; }; }
    if (!apiURL) { setReport(null); return; }
    setLoading(true);
    request<ResearchReport>(apiURL, `/research?pick_id=${encodeURIComponent(pick.id)}`)
      .then(data => { if (!cancelled) setReport(data); })
      .catch(() => { if (!cancelled) setError('Research history could not be loaded. Check your connection and update the backend if needed.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; active.current = false; };
  }, [pick, source, apiURL]);

  const search = async () => {
    if (!apiURL || busy.current) return;
    busy.current = true;
    setSearching(true);
    setError('');
    try {
      const data = await request<ResearchReport>(apiURL, '/research', { pick_id: pick.id }, 110000);
      if (active.current) setReport(data);
    } catch (e) {
      if (active.current) setError(`${e instanceof Error ? e.message : 'Search failed'}. Existing prices were not changed.`);
    } finally {
      busy.current = false;
      if (active.current) setSearching(false);
    }
  };

  const openSource = async (url: string) => {
    if (!url.startsWith('https://')) return;
    try { await Linking.openURL(url); }
    catch { setError('This source could not be opened on your device.'); }
  };
  const trend = report ? describeTrend(report.timeline.points) : null;
  return <View style={{ gap: 18 }}>
    <View style={s.card}>
      <Text style={s.kicker}>PRICE HISTORY</Text>
      <Text style={s.heading}>{trend?.headline ?? 'Collecting price history'}</Text>
      {loading && <ActivityIndicator color="#6CF2B1" />}
      {report && <>
        <Text style={s.small}>{report.timeline.label} · {pick.book}</Text>
        {report.timeline.simulated && <Text style={s.warning}>SIMULATED · These are fictional example prices, not market observations.</Text>}
        <PriceChart points={report.timeline.points} />
        {trend?.change !== null && trend?.change !== undefined && <Text style={s.body}>Break-even chance changed {(trend.change * 100).toFixed(2)} percentage points across {report.timeline.points.length} recorded quotes.</Text>}
        {!advanced && report.timeline.status === 'available' && <Text style={s.small}>An improved payout means more potential profit for the same stake. It does not mean the team is more likely to win.</Text>}
        {report.timeline.status === 'collecting' && <Text style={s.body}>At least two distinct quote timestamps are needed. Refresh prices over time to build history; the backend does not continuously collect prices while closed.</Text>}
        {advanced && report.timeline.points.length > 0 && <>
          <Text style={s.small}>Coverage: {date(report.timeline.points[0].timestamp)} → {date(report.timeline.points[report.timeline.points.length - 1].timestamp)}</Text>
          {report.timeline.best_odds !== null && <Text style={s.small}>Best recorded payout in this window: {odds(report.timeline.best_odds)}</Text>}
          {report.timeline.points.slice(-6).map((point, i) => <View key={i} style={s.row}>
            <Text style={[s.small, { flex: 1 }]}>{date(point.timestamp)}</Text><Text style={s.value}>{odds(point.american_odds)}</Text>
          </View>)}
        </>}
        <Text style={s.small}>A move describes price, not its cause. No sharp-money, public-betting or injury-causation claim is inferred from this chart.</Text>
      </>}
    </View>
    <View style={s.card}>
      <Text style={s.kicker}>GAME RESEARCH</Text>
      <Text style={s.heading}>{advanced ? 'Sources, statistics & context' : 'What else should I know?'}</Text>
      <Text style={s.body}>Team form, injuries, weather, schedule situations and historical context—with sources and missing-data labels.</Text>
      {report?.status === 'demo' && <Text style={s.warning}>Demo preview: the checklist below explains what to investigate. No live web search, real statistics, injury reports or weather have been retrieved for this fictional game.</Text>}
      {report?.status === 'needs_config' && <Text style={s.body}>Live research is not connected yet. Your backend needs an OpenAI API key. Keep that key on the server, never in the iPhone app.</Text>}
      {source === 'live' && report && report.status !== 'needs_config' && <>
        <Text style={s.small}>Runs only when you tap below. Uses OpenAI API billing; cached for up to 15 minutes to reduce repeated charges. ChatGPT subscriptions do not include API usage.</Text>
        <Pressable accessibilityRole="button" disabled={searching || loading} onPress={() => { void search(); }} style={[s.button, (searching || loading) && { opacity: .5 }]}>
          <Text style={s.buttonText}>{searching ? 'Searching current sources…' : report.status === 'ready' ? 'Check research (15-minute cache)' : 'Search latest context'}</Text>
        </Pressable>
        {searching && <><ActivityIndicator color="#6CF2B1" /><Text style={s.small}>Research can take around 90 seconds. You can close this report; a completed result can be reused from the server cache.</Text></>}
      </>}
      {!!error && <Text accessibilityRole="alert" style={s.warning}>{error}</Text>}
      {report?.generated_at && <Text style={s.small}>{report.status === 'demo' ? 'Preview created' : 'Research retrieved'} · {date(report.generated_at)}{report.cached ? ' · cached' : ''}</Text>}
      {report?.model && advanced && <Text style={s.small}>Research model: {report.model} · OpenAI live web search</Text>}
      {report?.sections.map(section => <View key={section.topic} style={s.section}>
        <Text style={s.heading}>{section.title}</Text>
        <Text style={s.kicker}>{report.status === 'demo' ? 'RESEARCH CHECKLIST' : section.status === 'reported' ? 'SOURCE-BASED AI SUMMARY' : section.status === 'uncertain' ? 'UNCERTAIN OR MIXED EVIDENCE' : 'EVIDENCE UNAVAILABLE'}</Text>
        <Text style={s.body}>{section.beginner}</Text>
        {advanced && <>
          <Text style={s.body}>{section.advanced}</Text>
          {section.metrics.map((metric, i) => <View key={i} style={s.metric}>
            <Text style={s.value}>{metric.label}: {metric.value}</Text>
            <Text style={s.small}>Period: {metric.period || 'not provided'} · Sample size: {metric.sample_size ?? 'not reported'}</Text>
          </View>)}
        </>}
        {section.as_of && <Text style={s.small}>Source context as of: {section.as_of}</Text>}
        {section.source_ids.map(id => {
          const citation = report.sources.find(item => item.id === id);
          return citation && <Pressable accessibilityRole="link" key={id} style={s.source} onPress={() => { void openSource(citation.url); }}>
            <Text style={s.link}>{id} · {citation.title}</Text><Text style={s.small}>{citation.url}</Text>
          </Pressable>;
        })}
      </View>)}
      <Text style={s.small}>AI summaries and statistics can be wrong; check the linked source and its date. Search context is not a calibrated model and does not change the quoted consensus probability or EV. Old or conflicting reports need extra care.</Text>
    </View>
  </View>;
}

const s = StyleSheet.create({
  card: { padding: 18, gap: 15, borderRadius: 18, backgroundColor: '#121E2D', borderWidth: 1, borderColor: '#233346' },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: '#6CF2B1' },
  heading: { fontSize: 18, fontWeight: '700', color: '#F3F6FC' },
  body: { fontSize: 14, lineHeight: 22, color: '#D9E5F2' },
  small: { fontSize: 12, lineHeight: 19, color: '#9DACBF' },
  value: { fontSize: 14, lineHeight: 22, fontWeight: '700', color: '#D9E5F2' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, justifyContent: 'space-between' },
  warning: { fontSize: 12, lineHeight: 19, color: '#F3CF80' },
  section: { gap: 12, paddingTop: 16, borderTopWidth: 1, borderColor: '#304052' },
  button: { padding: 15, minHeight: 48, borderRadius: 12, alignItems: 'center', backgroundColor: '#6CF2B1' },
  buttonText: { fontSize: 14, fontWeight: '800', color: '#0A251B' },
  source: { paddingVertical: 10, gap: 4, minHeight: 44 },
  link: { fontSize: 13, lineHeight: 20, fontWeight: '700', color: '#6CF2B1' },
  metric: { gap: 4, backgroundColor: '#09111D', borderRadius: 10, padding: 12 },
});
