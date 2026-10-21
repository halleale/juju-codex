import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from backend.engine import decimal_odds


class Store:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = str(path)
        with self.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS bets (
                id INTEGER PRIMARY KEY, pick_id TEXT UNIQUE, matchup TEXT,
                selection TEXT, book TEXT, american_odds REAL, stake REAL,
                source TEXT, created_at TEXT, status TEXT DEFAULT 'pending', profit REAL DEFAULT 0)''')
            db.execute('''CREATE TABLE IF NOT EXISTS quote_history (
                event_id TEXT, book_key TEXT, selection TEXT, quote_at TEXT,
                american_odds REAL, no_vig_probability REAL, observed_at TEXT,
                PRIMARY KEY (event_id, book_key, selection, quote_at))''')
            db.execute('CREATE TABLE IF NOT EXISTS research_requests (id INTEGER PRIMARY KEY, requested_at REAL)')

    def reserve_research_request(self, limit, now):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            count = db.execute('SELECT COUNT(*) FROM research_requests WHERE requested_at >= ?', (now - 3600,)).fetchone()[0]
            if count >= limit:
                return False
            db.execute('INSERT INTO research_requests (requested_at) VALUES (?)', (now,))
            db.execute('DELETE FROM research_requests WHERE requested_at < ?', (now - 86400,))
            return True

    def record_quotes(self, events, source, now=None):
        """Save genuine pre-game observations; demo data must never enter live history."""
        if source != 'live':
            return
        now = now or datetime.now(timezone.utc)
        rows = []
        for event in events:
            if datetime.fromisoformat(event['commence_time'].replace('Z', '+00:00')) <= now:
                continue
            teams = {event['home_team'], event['away_team']}
            for book in event.get('bookmakers', []):
                updated = datetime.fromisoformat(book['last_update'].replace('Z', '+00:00')).astimezone(timezone.utc)
                if not 0 <= (now - updated).total_seconds() <= 900:
                    continue
                market = next((m for m in book.get('markets', []) if m['key'] == 'h2h'), None)
                if not market:
                    continue
                prices = {o['name']: o['price'] for o in market['outcomes']}
                if set(prices) != teams:
                    continue
                try:
                    probabilities = {team: 1 / decimal_odds(price) for team, price in prices.items()}
                except ValueError:
                    continue
                total = sum(probabilities.values())
                rows.extend((event['id'], book['key'], team, updated.isoformat(), price,
                             probabilities[team] / total, now.isoformat()) for team, price in prices.items())
        with self.connect() as db:
            # Preserve the first observation. Repeated polling of an unchanged vendor quote is not history.
            db.executemany('INSERT OR IGNORE INTO quote_history VALUES (?, ?, ?, ?, ?, ?, ?)', rows)

    def history(self, pick):
        book_key = pick.get('analysis', {}).get('offering_book_key')
        with self.connect() as db:
            rows = db.execute('''SELECT quote_at AS timestamp, american_odds, no_vig_probability, observed_at
                FROM quote_history WHERE event_id = ? AND book_key = ? AND selection = ?
                ORDER BY quote_at DESC LIMIT 120''', (pick['event_id'], book_key, pick['selection'])).fetchall()
        return [dict(row) for row in reversed(rows)]

    def connect(self):
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        return db

    def list(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute('SELECT * FROM bets ORDER BY id DESC')]

    def add(self, pick, stake, source):
        if isinstance(stake, bool) or not isinstance(stake, (int, float)) or not math.isfinite(stake) or not 0 < stake <= 10000:
            raise ValueError('Stake must be greater than 0 and at most 10,000 units')
        decimal_odds(pick['american_odds'])
        with self.connect() as db:
            db.execute('''INSERT INTO bets
                (pick_id, matchup, selection, book, american_odds, stake, source, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                (pick['id'], pick['matchup'], pick['selection'], pick['book'],
                 pick['american_odds'], stake, source, datetime.now(timezone.utc).isoformat()))

    def settle(self, bet_id, status):
        if status not in ('won', 'lost', 'push'):
            raise ValueError('Result must be won, lost, or push')
        with self.connect() as db:
            bet = db.execute('SELECT * FROM bets WHERE id = ?', (bet_id,)).fetchone()
            if not bet:
                raise ValueError('Bet not found')
            if bet['status'] != 'pending':
                raise ValueError('Bet already settled')
            profit = bet['stake'] * (decimal_odds(bet['american_odds']) - 1) if status == 'won' else -bet['stake'] if status == 'lost' else 0
            db.execute('UPDATE bets SET status = ?, profit = ? WHERE id = ?', (status, profit, bet_id))
