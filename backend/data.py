import json
import os
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from urllib.parse import urlencode


def load_events():
    key = os.environ.get('ODDS_API_KEY')
    if not key:
        now = datetime.now(timezone.utc)
        event = {
            'id': 'demo-nfl', 'home_team': 'Kansas City Chiefs',
            'away_team': 'Buffalo Bills',
            'commence_time': (now + timedelta(days=2)).isoformat(),
            'bookmakers': [],
        }
        for name, prices in [('Demo A', (120, -140)), ('Demo B', (100, -120)),
                             ('Demo C', (102, -122)), ('Demo D', (100, -120))]:
            event['bookmakers'].append({
                'key': name, 'title': name, 'last_update': now.isoformat(),
                'markets': [{'key': 'h2h', 'outcomes': [
                    {'name': event['away_team'], 'price': prices[0]},
                    {'name': event['home_team'], 'price': prices[1]},
                ]}],
            })
        return [event], 'demo'
    query = urlencode({'apiKey': key, 'regions': 'us', 'markets': 'h2h', 'oddsFormat': 'american'})
    request = Request('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?' + query)
    # Never log the request URL: it contains the provider credential.
    with urlopen(request, timeout=20) as response:
        return json.load(response), 'live'
