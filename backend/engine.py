"""Transparent moneyline screening; consensus is an estimate, not a forecast."""
from datetime import datetime, timezone
from math import isfinite
from statistics import median


def decimal_odds(american):
    if not isinstance(american, (int, float)) or isinstance(american, bool) or not isfinite(american) or abs(american) < 100:
        raise ValueError('American odds must be <= -100 or >= 100')
    return 1 + (american / 100 if american > 0 else 100 / -american)


def screen(events, now=None):
    now = now or datetime.now(timezone.utc)
    picks = []
    for event in events:
        start = datetime.fromisoformat(event['commence_time'].replace('Z', '+00:00'))
        if start <= now:
            continue
        teams = {event['home_team'], event['away_team']}
        books = {}
        for book in event.get('bookmakers', []):
            updated = datetime.fromisoformat(book['last_update'].replace('Z', '+00:00'))
            age = (now - updated).total_seconds()
            if not 0 <= age <= 900:
                continue
            market = next((m for m in book.get('markets', []) if m['key'] == 'h2h'), None)
            if not market:
                continue
            outcomes = {o['name']: o['price'] for o in market['outcomes']}
            if set(outcomes) != teams:
                continue
            try:
                implied = {team: 1 / decimal_odds(price) for team, price in outcomes.items()}
            except ValueError:
                continue
            total = sum(implied.values())
            books[book['key']] = (book, outcomes, {team: p / total for team, p in implied.items()})
        for key, (book, prices, _) in books.items():
            others = [entry[2] for other, entry in books.items() if other != key]
            if len(others) < 3:
                continue
            for team, price in prices.items():
                probability = median(other[team] for other in others)
                ev = probability * decimal_odds(price) - 1
                if ev < .02:
                    continue
                picks.append({
                    'id': f"{event['id']}:{key}:{team}", 'event_id': event['id'],
                    'matchup': f"{event['away_team']} at {event['home_team']}",
                    'selection': team, 'book': book['title'], 'american_odds': price,
                    'probability': probability, 'expected_value': ev,
                    'reference_books': len(others), 'commence_time': event['commence_time'],
                    'updated_at': book['last_update'],
                })
    return sorted(picks, key=lambda pick: pick['expected_value'], reverse=True)
