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
