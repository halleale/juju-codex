import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { demoFeed, settleDemo, summary, trackDemo, validateStake } from '../src/domain.ts';
import { normalizeURL, request } from '../src/api.ts';
import { analyzePick } from '../src/analysis.ts';
import { decimalOdds } from '../src/domain.ts';
import { demoResearch, describeTrend } from '../src/research.ts';

test('research demo has explicit simulated history and no fabricated current facts', () => {
  const report = demoResearch(demoFeed().picks[0]);
  assert.equal(report.status, 'demo');
  assert.equal(report.timeline.simulated, true);
  assert.equal(report.timeline.points.length, 4);
  assert.equal(report.sections.length, 5);
  assert.deepEqual(report.sources, []);
  assert.ok(report.sections.every(section => section.status === 'unavailable' && section.metrics.length === 0));
  assert.ok(describeTrend(report.timeline.points).change! < 0);
  assert.equal(describeTrend(report.timeline.points.slice(0, 1)).change, null);
  const reverse = [...report.timeline.points].reverse();
  assert.ok(describeTrend(reverse).change! > 0);
});

test('analysis reconciles reference prices and makes expected return reproducible', () => {
  const pick = demoFeed().picks[0];
  const analysis = analyzePick(pick);
  assert.equal(analysis.evidenceVerified, true);
  assert.ok(Math.abs(analysis.breakEven - 1 / 2.2) < 1e-10);
  assert.ok(Math.abs(analysis.ev - pick.expected_value) < 1e-10);
  assert.ok(Math.abs(analysis.fairOdds - (1200 / 11)) < 1e-10);
  assert.equal(analysis.minimumOdds, 114);
  assert.ok(pick.probability * decimalOdds(analysis.minimumOdds) - 1 >= .02);
  assert.ok(pick.probability * decimalOdds(analysis.minimumOdds - 1) - 1 < .02);
  assert.equal(analysis.scenarios[0].shift, -.02);
  assert.ok(analysis.scenarios[0].ev < .02);
  assert.ok(analysis.scenarios[0].ev > 0);
  assert.equal(analysis.scenarios[1].ev, analysis.ev);
});

test('analysis refuses to call missing, duplicated, self-referencing or altered evidence verified', () => {
  const pick = demoFeed().picks[0];
  assert.equal(analyzePick({ ...pick, analysis: undefined }).evidenceVerified, false);
  assert.equal(analyzePick({ ...pick, probability: .6 }).evidenceVerified, false);
  assert.equal(analyzePick({ ...pick, expected_value: .5 }).evidenceVerified, false);
  const audit = pick.analysis!;
  const duplicate = [audit.references[0], audit.references[0], audit.references[2]];
  assert.equal(analyzePick({ ...pick, analysis: { ...audit, references: duplicate } }).evidenceVerified, false);
  const self = [{ ...audit.references[0], key: audit.offering_book_key }, ...audit.references.slice(1)];
  assert.equal(analyzePick({ ...pick, analysis: { ...audit, references: self } }).evidenceVerified, false);
});

test('negative moneyline thresholds and high-probability sensitivity are valid', () => {
  const pick = { ...demoFeed().picks[0], american_odds: -120, probability: .6, analysis: undefined };
  const analysis = analyzePick(pick);
  assert.equal(analysis.minimumOdds, -142);
  assert.ok(.6 * decimalOdds(analysis.minimumOdds) - 1 >= .02);
  assert.ok(.6 * decimalOdds(analysis.minimumOdds - 1) - 1 < .02);
  const extreme = analyzePick({ ...pick, probability: .99 });
  assert.equal(extreme.scenarios[2].probability, 1);
});

test('demo lifecycle rejects duplicates and repeat settlement and computes ROI', () => {
  const feed = demoFeed();
  assert.equal(feed.source, 'demo');
  assert.ok(feed.picks.length > 0);
  const pick = feed.picks[0];
  assert.ok(pick.expected_value > 0.02);
  const tracked = trackDemo([], pick, 2);
  assert.throws(() => trackDemo(tracked, pick, 2), /already tracked/);
  const settled = settleDemo(tracked, tracked[0].id, 'won');
  assert.equal(settled[0].source, 'demo');
  assert.ok(Math.abs(settled[0].profit - 2.4) < 1e-10);
  assert.ok(Math.abs(summary(settled).roi! - 1.2) < 1e-10);
  assert.equal(summary(settled).pending, 0);
  assert.equal(tracked[0].status, 'pending');
  assert.throws(() => settleDemo(settled, tracked[0].id, 'lost'), /already settled/);
});

test('losses and pushes settle correctly; pending stakes excluded from ROI', () => {
  const pick = demoFeed().picks[0];
  const pending = trackDemo([], pick, 3);
  assert.equal(summary(pending).roi, null);
  assert.equal(summary(pending).pending, 1);
  assert.equal(summary(settleDemo(pending, pending[0].id, 'lost')).profit, -3);
  assert.equal(summary(settleDemo(pending, pending[0].id, 'push')).profit, 0);
  for (const stake of [0, -1, NaN, Infinity, 10001]) assert.throws(() => validateStake(stake));
  assert.throws(() => trackDemo([], { ...pick, commence_time: '2020-01-01T00:00:00Z' }, 1), /started/);
});

test('API URL rejects credentials and unsupported protocols', () => {
  assert.equal(normalizeURL(' http://192.168.1.20:8000/ '), 'http://192.168.1.20:8000');
  for (const url of ['file:///etc/passwd', 'https://user:secret@example.com', 'https://example.com?key=secret']) {
    assert.throws(() => normalizeURL(url));
  }
});

test('mobile API client completes tracking and settlement against Python backend', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'edgebook-mobile-'));
  const code = `
from backend import server
server.store = server.Store(${JSON.stringify(join(directory, 'test.sqlite3'))})
httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
print(httpd.server_port, flush=True)
httpd.serve_forever()
`;
  const child = spawn('python3', ['-c', code], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, ODDS_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const lines = createInterface({ input: child.stdout });
    const [line] = await once(lines, 'line');
    const base = `http://127.0.0.1:${line}`;
    const feed = await request<ReturnType<typeof demoFeed>>(base, '/recommendations');
    assert.equal(feed.source, 'demo');
    const pick = feed.picks[0];
    const analysis = analyzePick(pick);
    assert.equal(analysis.evidenceVerified, true);
    assert.equal(analysis.references.length, 3);
    const researchPath = `/research?pick_id=${encodeURIComponent(pick.id)}`;
    const preview = await request<ReturnType<typeof demoResearch>>(base, researchPath);
    assert.equal(preview.status, 'demo');
    assert.equal(preview.timeline.simulated, true);
    assert.equal(preview.sections.length, 5);
    const researched = await request<ReturnType<typeof demoResearch>>(base, '/research', { pick_id: pick.id });
    assert.equal(researched.status, 'demo');
    assert.deepEqual(researched.sources, []);
    await request(base, '/bets', { pick_id: pick.id, stake: 2 });
    const bets = await request<Array<{ id: number; status: string; profit: number }>>(base, '/bets');
    assert.equal(bets.length, 1);
    await assert.rejects(request(base, '/bets', { pick_id: pick.id, stake: 2 }), /already tracked/);
    await request(base, '/settle', { bet_id: bets[0].id, status: 'won' });
    const settled = await request<typeof bets>(base, '/bets');
    assert.equal(settled[0].status, 'won');
    assert.ok(settled[0].profit > 0);
    await assert.rejects(request(base, '/settle', { bet_id: bets[0].id, status: 'lost' }));
    lines.close();
  } finally {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});

test('live-path research HTTP integration returns cited fixtures without paid network calls', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'edgebook-research-'));
  const code = `
from backend import server
import backend.research as research_module
from backend.tests.test_research import provider_response
server.store = server.Store(${JSON.stringify(join(directory, 'test.sqlite3'))})
events, _ = server.load_events()
server.load_events = lambda: (events, 'live')
research_module.search = lambda *args: provider_response()
httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
print(httpd.server_port, flush=True)
httpd.serve_forever()
`;
  const child = spawn('python3', ['-c', code], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, ODDS_API_KEY: '', OPENAI_API_KEY: '', EDGEBOOK_RESEARCH_API_KEY: 'test-key-not-real' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const lines = createInterface({ input: child.stdout });
    const [line] = await once(lines, 'line');
    const base = `http://127.0.0.1:${line}`;
    const feed = await request<ReturnType<typeof demoFeed>>(base, '/recommendations');
    const pick = feed.picks[0];
    const path = `/research?pick_id=${encodeURIComponent(pick.id)}`;
    const preview = await request<ReturnType<typeof demoResearch>>(base, path);
    assert.equal(preview.status, 'not_requested');
    assert.equal(preview.timeline.simulated, false);
    assert.equal(preview.timeline.status, 'collecting');
    const researched = await request<ReturnType<typeof demoResearch>>(base, '/research', { pick_id: pick.id });
    assert.equal(researched.status, 'ready');
    assert.equal(researched.sections.length, 5);
    assert.equal(researched.sources[0].url, 'https://www.nfl.com/injuries/');
    assert.ok(researched.sections.every(section => section.source_ids.includes(researched.sources[0].id)));
    const cached = await request<ReturnType<typeof demoResearch>>(base, path);
    assert.equal(cached.cached, true);
    const again = await request<ReturnType<typeof demoFeed>>(base, '/recommendations');
    assert.equal(again.picks[0].probability, pick.probability);
    assert.equal(again.picks[0].expected_value, pick.expected_value);
    lines.close();
  } finally {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
