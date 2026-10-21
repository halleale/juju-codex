"""Local, single-user development API. Bind to loopback unless using a trusted LAN."""
import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from backend.data import load_events
from backend.engine import screen
from backend.store import Store

store = None
cache = None
cache_lock = threading.Lock()


def recommendations():
    global cache
    with cache_lock:
        if cache is None or time.monotonic() - cache[0] > 60:
            events, source = load_events()
            cache = (time.monotonic(), {
                'source': source, 'generated_at': datetime.now(timezone.utc).isoformat(),
                'methodology': 'Median no-vig probability from at least 3 other sportsbooks; 2% estimated EV minimum. Quotes older than 15 minutes excluded. Consensus is not a validated predictive model.',
                'picks': screen(events),
            })
        return cache[1]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, payload):
        body = json.dumps(payload, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        try:
            if self.path == '/health':
                self.reply(200, {'status': 'ok'})
            elif self.path == '/recommendations':
                self.reply(200, recommendations())
            elif self.path == '/bets':
                self.reply(200, store.list())
            else:
                self.reply(404, {'error': 'Not found'})
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError, TypeError):
            self.reply(502, {'error': 'Unable to load odds. Check provider access and quota; no fallback picks were substituted.'})

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 16384:
                raise ValueError('Invalid request size')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('Expected a JSON object')
            if self.path == '/bets':
                response = recommendations()
                pick = next((p for p in response['picks'] if p['id'] == data.get('pick_id')), None)
                if not pick or datetime.fromisoformat(pick['commence_time'].replace('Z', '+00:00')) <= datetime.now(timezone.utc):
                    raise ValueError('Recommendation unavailable or event started; refresh picks')
                store.add(pick, data.get('stake'), response['source'])
                self.reply(201, {'status': 'tracked'})
            elif self.path == '/settle':
                if type(data.get('bet_id')) is not int:
                    raise ValueError('Expected an integer bet ID')
                store.settle(data['bet_id'], data.get('status'))
                self.reply(200, {'status': 'settled'})
            else:
                self.reply(404, {'error': 'Not found'})
        except sqlite3.IntegrityError:
            self.reply(409, {'error': 'This recommendation is already tracked'})
        except (ValueError, TypeError, KeyError):
            self.reply(400, {'error': 'Invalid request, stake, or settlement; refresh and try again'})
        except (HTTPError, URLError, TimeoutError, OSError):
            self.reply(502, {'error': 'Odds provider unavailable'})


if __name__ == '__main__':
    store = Store(os.environ.get('EDGEBOOK_DB', str(Path(__file__).resolve().parents[1] / '.local' / 'edgebook.sqlite3')))
    server = ThreadingHTTPServer((os.environ.get('EDGEBOOK_HOST', '127.0.0.1'), int(os.environ.get('PORT', '8000'))), Handler)
    print('Edgebook development API started', flush=True)
    server.serve_forever()
