import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { demoFeed, settleDemo, summary, trackDemo, validateStake } from './src/domain';
import type { Bet, Feed, Pick, Result } from './src/domain';
import { normalizeURL, request } from './src/api';

type Settings = { mode: 'demo' | 'api'; url: string };
const SETTINGS_KEY = 'edgebook.settings.v1';
const BETS_KEY = 'edgebook.offline-bets.v1';
const money = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const odds = (n: number) => `${n > 0 ? '+' : ''}${n}`;
const date = (s: string) => new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Button({ title, onPress, secondary = false, disabled = false }: {
  title: string; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, (pressed || disabled) && { opacity: 0.5 }]}>
    <Text style={[styles.buttonText, secondary && { color: '#D9E5F2' }]}>{title}</Text>
  </Pressable>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={{ flex: 1 }}><Text style={styles.small}>{label}</Text><Text style={styles.metric}>{value}</Text></View>;
}

function Edgebook() {
  const [tab, setTab] = useState('Picks');
  const [settings, setSettings] = useState<Settings>({ mode: 'demo', url: '' });
  const [url, setURL] = useState('');
  const [ready, setReady] = useState(false);
  const [storageIssue, setStorageIssue] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [feed, setFeed] = useState<Feed | null>(null);
  const [demoBets, setDemoBets] = useState<Bet[]>([]);
  const [bets, setBets] = useState<Bet[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<Pick | null>(null);
  const [stake, setStake] = useState('1');
  const [trackerSource, setTrackerSource] = useState<'demo' | 'live'>('demo');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [savedSettings, savedBets] = await Promise.all([AsyncStorage.getItem(SETTINGS_KEY), AsyncStorage.getItem(BETS_KEY)]);
        if (cancelled) return;
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings) as Settings;
          if (parsed.mode === 'api') parsed.url = normalizeURL(parsed.url);
          else if (parsed.mode !== 'demo') throw new Error('Invalid saved connection settings');
          setSettings(parsed);
          setURL(parsed.url);
        }
        if (savedBets) {
          const parsed = JSON.parse(savedBets);
          if (!Array.isArray(parsed)) throw new Error('Invalid saved tracker');
          setDemoBets(parsed);
        }
      } catch {
        if (!cancelled) {
          setStorageIssue(true);
          setError('Saved settings or tracker could not be loaded. Existing storage has not been erased; on-device tracker changes are blocked.');
        }
      } finally { if (!cancelled) setReady(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    setFeed(null);
    setBets([]);
    (async () => {
      try {
        const [nextFeed, nextBets] = settings.mode === 'demo'
          ? [demoFeed(), demoBets] as const
          : await Promise.all([request<Feed>(settings.url, '/recommendations'), request<Bet[]>(settings.url, '/bets')]);
        if (!cancelled) {
          setFeed(nextFeed);
          setBets(nextBets);
          setTrackerSource(nextFeed.source);
        }
      } catch (e) {
        if (!cancelled) setError(`${e instanceof Error ? e.message : 'Connection failed'}. Check that your phone can reach the API address in Settings.`);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [ready, settings, refresh, demoBets]);

  const run = async (action: () => Promise<void>) => {
    if (lock.current || loading) return;
    lock.current = true;
    setSaving(true);
    setError('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not complete request.'); }
    finally { lock.current = false; setSaving(false); }
  };

  const connect = (mode: Settings['mode']) => run(async () => {
    const next = { mode, url: mode === 'api' ? normalizeURL(url) : settings.url };
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    setSettings(next);
    setSelected(null);
  });

  const track = () => run(async () => {
    if (!selected) return;
    const amount = Number(stake);
    validateStake(amount);
    if (settings.mode === 'demo') {
      if (storageIssue) throw new Error('Saved records could not be loaded. Resolve the storage issue before changing on-device records.');
      const next = trackDemo(demoBets, selected, amount);
      await AsyncStorage.setItem(BETS_KEY, JSON.stringify(next));
      setDemoBets(next);
    } else {
      await request(settings.url, '/bets', { pick_id: selected.id, stake: amount });
      setRefresh(value => value + 1);
    }
    setSelected(null);
    setTab('Tracker');
  });

  const settle = (bet: Bet, result: Result) => run(async () => {
    if (settings.mode === 'demo') {
      if (storageIssue) throw new Error('Saved records could not be loaded. Resolve the storage issue before changing on-device records.');
      const next = settleDemo(demoBets, bet.id, result);
      await AsyncStorage.setItem(BETS_KEY, JSON.stringify(next));
      setDemoBets(next);
    } else {
      await request(settings.url, '/settle', { bet_id: bet.id, status: result });
      setRefresh(value => value + 1);
    }
  });

  const filtered = bets.filter(bet => bet.source === trackerSource);
  const stats = summary(filtered);
  const disabled = !ready || loading || saving;

  return <SafeAreaView style={styles.safe}>
    <StatusBar style="light" />
    <View style={styles.header}>
      <Text style={styles.wordmark}>edgebook<Text style={{ color: '#6CF2B1' }}>.</Text></Text>
      <Text style={styles.pill}>NFL</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} tintColor="#6CF2B1" enabled={!saving}
        onRefresh={() => { if (!saving) { setError(''); setRefresh(n => n + 1); } }} />}>
      {!!error && <View accessibilityRole="alert" style={styles.error}><Text style={styles.body}>{error}</Text>
        <Button title="Dismiss" secondary onPress={() => setError('')} />
      </View>}
      {!ready && <ActivityIndicator color="#6CF2B1" />}
      {tab === 'Picks' && <>
        <Text style={styles.eyebrow}>THE PRICE IS THE OPPORTUNITY</Text>
        <Text style={styles.title}>Find your edge.</Text>
        <Text style={styles.subtitle}>NFL moneylines. Clear numbers. Every pick explained.</Text>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>{settings.mode === 'demo' ? 'ON-DEVICE DEMO' : feed?.source === 'live' ? 'LIVE ODDS' : 'BACKEND CONNECTION'}</Text>
          <Text style={styles.small}>{settings.mode === 'demo' || feed?.source === 'demo'
            ? 'Fictional prices for exploring the app. These are not real betting recommendations.'
            : 'Consensus estimates from sportsbook prices. An estimated edge is not a guarantee.'}</Text>
        </View>
        {loading && <ActivityIndicator color="#6CF2B1" />}
        {feed && <Text style={styles.small}>Updated {date(feed.generated_at)} · {feed.picks.length} qualifying price{feed.picks.length === 1 ? '' : 's'}</Text>}
        {feed?.picks.map(pick => <View key={pick.id} style={styles.card}>
          <View style={styles.row}><Text style={styles.eyebrow}>MONEYLINE</Text><Text style={styles.small}>{pick.book}</Text></View>
          <Text style={styles.small}>{pick.matchup}</Text>
          <View style={styles.row}><Text style={[styles.pickTitle, { flex: 1 }]}>{pick.selection}</Text><Text style={styles.price}>{odds(pick.american_odds)}</Text></View>
          <View style={styles.metrics}>
            <Metric label="EST. EV" value={`+${(pick.expected_value * 100).toFixed(1)}%`} />
            <Metric label="CONSENSUS" value={`${(pick.probability * 100).toFixed(1)}%`} />
            <Metric label="REFERENCES" value={`${pick.reference_books} books`} />
          </View>
          <Text style={styles.small}>Kickoff · {date(pick.commence_time)}</Text>
          <Text style={styles.small}>Quote · {date(pick.updated_at)}</Text>
          <Button title={bets.some(b => b.pick_id === pick.id) ? 'Already tracked' : 'Track recommendation'}
            disabled={disabled || bets.some(b => b.pick_id === pick.id)} onPress={() => { setStake('1'); setSelected(pick); }} />
        </View>)}
        {feed && !feed.picks.length && <View style={styles.card}><Text style={styles.pickTitle}>No qualifying prices</Text><Text style={styles.body}>No current quote meets the 2% estimated EV and three-reference-book requirements.</Text></View>}
        {!feed && !loading && ready && <Button title="Retry connection" disabled={saving} onPress={() => { setError(''); setRefresh(n => n + 1); }} />}
        <Text style={styles.footnote}>A pricing reference, not a proven forecasting model. Verify the price before acting. No wagers are placed by this app.</Text>
      </>}
      {tab === 'Tracker' && <>
        <Text style={styles.eyebrow}>MEASURE THE OUTCOME</Text>
        <Text style={styles.title}>Your record.</Text>
        <Text style={styles.subtitle}>Track in units. Settle manually. See what holds up.</Text>
        <View style={styles.row}>
          {(['demo', 'live'] as const).map(source => <Button key={source} secondary={source !== trackerSource}
            title={source === 'demo' ? 'Demo records' : 'Live records'} onPress={() => setTrackerSource(source)} />)}
        </View>
        <View style={styles.card}>
          <Text style={styles.small}>NET RESULT · {trackerSource.toUpperCase()}</Text>
          <Text style={styles.price}>{money(stats.profit)} units</Text>
          <View style={styles.metrics}>
            <Metric label="SETTLED ROI" value={stats.roi === null ? '—' : `${money(stats.roi * 100)}%`} />
            <Metric label="PENDING" value={String(stats.pending)} />
          </View>
        </View>
        {!filtered.length && <Text style={styles.body}>No records here yet. Track a recommendation to get started.</Text>}
        {filtered.map(bet => <View style={styles.card} key={bet.id}>
          <Text style={styles.pickTitle}>{bet.selection}</Text>
          <Text style={styles.small}>{bet.matchup}</Text>
          <Text style={styles.body}>{bet.book} · {odds(bet.american_odds)} · {bet.stake.toFixed(2)} units</Text>
          {bet.status === 'pending' ? <View style={styles.row}>
            {(['won', 'lost', 'push'] as const).map(result => <Button key={result} title={result.toUpperCase()} secondary disabled={disabled}
              onPress={() => Alert.alert('Record result?', `Mark this pick ${result}. Settlement is final in this prototype.`, [
                { text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: () => { void settle(bet, result); } },
              ])} />)}
          </View> : <Text style={styles.metric}>{bet.status.toUpperCase()} · {money(bet.profit)} units</Text>}
        </View>)}
        <Text style={styles.footnote}>{settings.mode === 'demo' ? 'On-device demo records persist on this phone. Backend records are stored separately.' : 'Backend tracker records. Demo and live performance are kept separate.'}</Text>
      </>}
      {tab === 'Settings' && <>
        <Text style={styles.eyebrow}>KNOW YOUR INPUTS</Text>
        <Text style={styles.title}>The method.</Text>
        <View style={styles.card}>
          <Text style={styles.pickTitle}>Data connection</Text>
          <Text style={styles.body}>Current: {settings.mode === 'demo' ? 'On-device demo · no server needed' : settings.url}</Text>
          <Button title="Use on-device demo" secondary disabled={disabled} onPress={() => { void connect('demo'); }} />
          <Text style={styles.small}>BACKEND API BASE URL</Text>
          <TextInput accessibilityLabel="Backend API base URL" style={styles.input} value={url} onChangeText={setURL}
            placeholder="http://192.168.1.20:8000" placeholderTextColor="#76879B" autoCapitalize="none" autoCorrect={false}
            keyboardType="url" editable={!disabled} />
          <Button title="Connect to backend" disabled={disabled || !url.trim()} onPress={() => { void connect('api'); }} />
          <Text style={styles.small}>Your phone must reach this address. Localhost on an iPhone means the phone itself. Use your computer's LAN address on the same trusted Wi-Fi. Provider keys stay on the server.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.pickTitle}>Show the work</Text>
          <Text style={styles.body}>1. Convert two-sided moneylines to implied probabilities and remove the bookmaker margin.</Text>
          <Text style={styles.body}>2. Exclude the offering book. Take the median probability from at least three other books.</Text>
          <Text style={styles.body}>3. Estimated EV = consensus probability × decimal odds − 1. Show estimates of at least 2%.</Text>
          <Text style={styles.body}>Only pre-game NFL moneylines. Exclude quotes older than 15 minutes.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.pickTitle}>Know the limits</Text>
          <Text style={styles.body}>Market consensus is a pricing reference, not an independently trained model. Profitability has not been validated. Demo examples are fictional.</Text>
          <Text style={styles.body}>For adults of legal betting age where permitted. Set limits and never chase losses. In the US, call 1-800-GAMBLER for support.</Text>
        </View>
      </>}
    </ScrollView>
    <View style={styles.tabs}>{['Picks', 'Tracker', 'Settings'].map(item => <Pressable accessibilityRole="tab" accessibilityState={{ selected: item === tab }}
      key={item} onPress={() => setTab(item)} style={styles.tab}>
      <Text style={[styles.tabText, tab === item && { color: '#6CF2B1' }]}>{item}</Text>
      <View style={[styles.tabDot, tab === item && { backgroundColor: '#6CF2B1' }]} />
    </Pressable>)}</View>
    <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => { if (!saving) setSelected(null); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.eyebrow}>TRACK, DON'T PLACE</Text>
          <Text style={styles.pickTitle}>{selected?.selection}</Text>
          <Text style={styles.body}>Record a stake in consistent units. No money is moved and no wager is placed.</Text>
          {!!error && <Text accessibilityRole="alert" style={{ color: '#FFBD95' }}>{error}</Text>}
          <TextInput accessibilityLabel="Stake in units" value={stake} onChangeText={setStake} keyboardType="decimal-pad"
            style={styles.input} editable={!saving} placeholder="Stake in units" placeholderTextColor="#76879B" />
          <Button title={saving ? 'Saving…' : 'Save to tracker'} disabled={disabled || !Number.isFinite(Number(stake)) || Number(stake) <= 0 || Number(stake) > 10000}
            onPress={() => { void track(); }} />
          <Button title="Cancel" secondary disabled={saving} onPress={() => setSelected(null)} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider><Edgebook /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#09111D' },
  header: { paddingHorizontal: 24, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderColor: '#1B293A' },
  wordmark: { fontSize: 27, fontWeight: '800', letterSpacing: -1, color: '#F3F6FC' },
  pill: { color: '#6CF2B1', backgroundColor: '#153B31', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, fontSize: 12, fontWeight: '800' },
  content: { padding: 24, gap: 18, paddingBottom: 40 },
  eyebrow: { color: '#6CF2B1', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: '#F3F6FC', fontSize: 38, fontWeight: '800', letterSpacing: -1.5 },
  subtitle: { color: '#9DACBF', fontSize: 16, lineHeight: 24 },
  notice: { backgroundColor: '#24251E', borderWidth: 1, borderColor: '#47422D', padding: 16, borderRadius: 14, gap: 7 },
  noticeTitle: { color: '#F3CF80', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  small: { color: '#9DACBF', fontSize: 12, lineHeight: 19 },
  body: { color: '#D9E5F2', fontSize: 14, lineHeight: 22 },
  card: { backgroundColor: '#121E2D', borderColor: '#233346', borderWidth: 1, borderRadius: 20, padding: 20, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  pickTitle: { color: '#F3F6FC', fontSize: 21, fontWeight: '700' },
  price: { color: '#6CF2B1', fontSize: 32, fontWeight: '700', fontVariant: ['tabular-nums'] },
  metrics: { flexDirection: 'row', gap: 12, paddingVertical: 14, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#233346' },
  metric: { color: '#6CF2B1', fontSize: 16, fontWeight: '700', marginTop: 5, fontVariant: ['tabular-nums'] },
  button: { backgroundColor: '#6CF2B1', paddingVertical: 15, paddingHorizontal: 16, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#0A251B', fontSize: 14, fontWeight: '800' },
  secondary: { backgroundColor: '#233346' },
  input: { backgroundColor: '#09111D', color: '#F3F6FC', borderWidth: 1, borderColor: '#3A4E65', borderRadius: 12, padding: 16, fontSize: 16 },
  footnote: { color: '#7D90A7', fontSize: 12, lineHeight: 19 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#233346', paddingTop: 12, paddingBottom: 6 },
  tab: { flex: 1, alignItems: 'center', minHeight: 44, gap: 8 },
  tabText: { color: '#9DACBF', fontSize: 13, fontWeight: '700' },
  tabDot: { width: 5, height: 5, borderRadius: 3 },
  error: { backgroundColor: '#432B29', padding: 16, borderRadius: 12, gap: 10 },
  overlay: { flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#121E2D', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 26, paddingBottom: 44, gap: 18 },
});
