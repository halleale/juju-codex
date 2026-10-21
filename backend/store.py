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
