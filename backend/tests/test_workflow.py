import copy
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from backend.data import load_events
from backend.engine import decimal_odds, screen
from backend.store import Store


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        with patch.dict('os.environ', {'ODDS_API_KEY': ''}):
            self.events, self.source = load_events()

    def test_american_odds(self):
        self.assertEqual(decimal_odds(120), 2.2)
        self.assertEqual(decimal_odds(-200), 1.5)
        for invalid in [0, 99, -90, True, float('nan'), float('inf')]:
            with self.assertRaises(ValueError):
                decimal_odds(invalid)

    def test_demo_value_excludes_offering_book(self):
        picks = screen(self.events)
        self.assertTrue(picks)
        pick = next(p for p in picks if p['book'] == 'Demo A')
        # Two of the three OTHER books quote +100/-120. Median no-vig p = 11/23.
        self.assertAlmostEqual(pick['probability'], 11 / 23)
        self.assertAlmostEqual(pick['expected_value'], (11 / 23) * 2.2 - 1)
        self.assertEqual(pick['reference_books'], 3)
        self.assertEqual(self.source, 'demo')

    def test_insufficient_books_yields_no_picks(self):
        self.events[0]['bookmakers'].pop()
        self.assertEqual(screen(self.events), [])

    def test_started_events_and_stale_quotes_excluded(self):
        event = self.events[0]
        event['commence_time'] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        self.assertEqual(screen(self.events), [])
        event['commence_time'] = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        event['bookmakers'][0]['last_update'] = (datetime.now(timezone.utc) - timedelta(minutes=16)).isoformat()
        self.assertEqual(screen(self.events), [])

    def test_even_market_has_no_edge(self):
        for book in self.events[0]['bookmakers']:
            for outcome in book['markets'][0]['outcomes']:
                outcome['price'] = -110
        self.assertEqual(screen(self.events), [])

    def test_tracking_settlements_and_persistence(self):
        pick = screen(self.events)[0]
        with tempfile.TemporaryDirectory() as directory:
            path = directory + '/bets.sqlite3'
            store = Store(path)
            for index, result in enumerate(['won', 'lost', 'push']):
                item = copy.deepcopy(pick)
                item['id'] += str(index)
                store.add(item, 2, 'demo')
                bet = store.list()[0]
                store.settle(bet['id'], result)
                saved = store.list()[0]
                expected = 2 * (decimal_odds(pick['american_odds']) - 1) if result == 'won' else -2 if result == 'lost' else 0
                self.assertAlmostEqual(saved['profit'], expected)
                with self.assertRaises(ValueError):
                    store.settle(bet['id'], result)
            self.assertEqual(len(Store(path).list()), 3)
            for invalid in [0, -1, float('nan'), float('inf'), True, '1', 10001]:
                with self.assertRaises(ValueError):
                    store.add(pick, invalid, 'demo')


if __name__ == '__main__':
    unittest.main()
