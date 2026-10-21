import copy
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from backend.data import load_events
from backend.engine import screen
from backend.store import Store
from backend.research import Research, ResearchRateLimited, TOPICS, parse_response, search, timeline


def provider_response():
    url = 'https://www.nfl.com/injuries/'
    sections = [{'topic': topic, 'status': 'uncertain', 'beginner': 'Fixture evidence, not current sports news.',
                 'advanced': 'Test-only context with limited sample size.', 'as_of': None,
                 'metrics': [{'label': 'Test sample', 'value': '2', 'period': 'Fixture period', 'sample_size': 2}],
                 'source_urls': [url]} for topic in TOPICS]
    return {'status': 'completed', 'output': [
        {'type': 'web_search_call', 'status': 'completed',
         'action': {'type': 'search', 'sources': [{'type': 'url', 'url': url}]}},
        {'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps({'sections': sections}),
                                      'annotations': [{'type': 'url_citation', 'url': url, 'title': 'NFL fixture source'}]}]},
    ]}


class ResearchTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict('os.environ', {'ODDS_API_KEY': '', 'EDGEBOOK_RESEARCH_API_KEY': '', 'OPENAI_API_KEY': ''})
        self.env.start()
        self.directory = tempfile.TemporaryDirectory()
        self.store = Store(self.directory.name + '/test.sqlite3')
        self.events, _ = load_events()
        self.pick = screen(self.events)[0]

    def tearDown(self):
        self.directory.cleanup()
        self.env.stop()

    def test_history_is_persistent_idempotent_and_excludes_demo(self):
        self.store.record_quotes(self.events, 'demo')
        self.assertEqual(self.store.history(self.pick), [])
        self.store.record_quotes(self.events, 'live')
        self.store.record_quotes(self.events, 'live')
        self.assertEqual(len(self.store.history(self.pick)), 1)
        changed = copy.deepcopy(self.events)
        now = datetime.now(timezone.utc)
        for book in changed[0]['bookmakers']:
            book['last_update'] = (now + timedelta(minutes=1)).isoformat()
            book['markets'][0]['outcomes'][0]['price'] = 130
        self.store.record_quotes(changed, 'live', now=now + timedelta(minutes=1))
        points = Store(self.store.path).history(self.pick)
        self.assertEqual(len(points), 2)
        trend = timeline(points)
        self.assertEqual(trend['status'], 'available')
        self.assertLess(trend['probability_change'], 0)
        self.assertEqual(trend['best_odds'], 130)
        self.assertIn('not the opening line', trend['label'])

    def test_first_quote_is_collecting_not_a_trend(self):
        self.store.record_quotes(self.events, 'live')
        trend = timeline(self.store.history(self.pick))
        self.assertEqual(trend['status'], 'collecting')
        self.assertIsNone(trend['probability_change'])

    def test_missing_credentials_and_demo_never_call_provider(self):
        service = Research(self.store)
        with patch('backend.research.search') as call:
            self.assertEqual(service.report(self.pick, 'live', run=True)['status'], 'needs_config')
            demo = service.report(self.pick, 'demo', run=True)
            self.assertEqual(demo['status'], 'demo')
            self.assertTrue(demo['timeline']['simulated'])
            self.assertFalse(demo['sources'])
            self.assertTrue(all(not section['metrics'] for section in demo['sections']))
            call.assert_not_called()

    def test_search_is_opt_in_cached_and_does_not_change_probability(self):
        original = copy.deepcopy(self.pick)
        service = Research(self.store)
        with patch.dict('os.environ', {'EDGEBOOK_RESEARCH_API_KEY': 'test-key-not-real'}):
            with patch('backend.research.search', return_value=provider_response()) as call:
                self.assertEqual(service.report(self.pick, 'live')['status'], 'not_requested')
                call.assert_not_called()
                result = service.report(self.pick, 'live', run=True)
                self.assertEqual(result['status'], 'ready')
                self.assertEqual(len(result['sections']), 5)
                self.assertTrue(result['sources'])
                self.assertTrue(service.report(self.pick, 'live', run=True)['cached'])
                self.assertEqual(call.call_count, 1)
                self.assertEqual(self.pick, original)

    def test_untraceable_claims_and_metrics_are_discarded(self):
        response = provider_response()
        data = json.loads(response['output'][1]['content'][0]['text'])
        data['sections'][0]['source_urls'] = ['https://made-up.example/fake']
        response['output'][1]['content'][0]['text'] = json.dumps(data)
        sections, sources = parse_response(response)
        self.assertEqual(sections[0]['status'], 'unavailable')
        self.assertEqual(sections[0]['metrics'], [])
        self.assertNotIn('Fixture evidence', sections[0]['beginner'])
        self.assertEqual(len(sources), 1)

    def test_request_limit_persists_across_service_instances(self):
        with patch.dict('os.environ', {'EDGEBOOK_RESEARCH_API_KEY': 'test-key-not-real', 'EDGEBOOK_RESEARCH_MAX_PER_HOUR': '1'}):
            with patch('backend.research.search', return_value=provider_response()) as call:
                Research(self.store).report(self.pick, 'live', run=True)
                with self.assertRaises(ResearchRateLimited):
                    Research(Store(self.store.path)).report(self.pick, 'live', run=True)
                self.assertEqual(call.call_count, 1)

    def test_incomplete_or_unsearched_responses_are_rejected(self):
        incomplete = provider_response()
        incomplete['status'] = 'incomplete'
        with self.assertRaises(ValueError):
            parse_response(incomplete)
        unsearched = provider_response()
        unsearched['output'] = unsearched['output'][1:]
        with self.assertRaises(ValueError):
            parse_response(unsearched)

    def test_opened_page_is_traceable_even_when_search_sources_are_null(self):
        response = provider_response()
        response['output'][0]['action'] = {'type': 'open_page', 'url': 'https://www.nfl.com/injuries/', 'sources': None}
        response['output'][1]['content'][0]['annotations'] = []
        sections, sources = parse_response(response)
        self.assertTrue(sources)
        self.assertTrue(all(section['source_ids'] for section in sections))

    def test_provider_payload_uses_live_search_and_never_sends_tracker_data(self):
        class Reply:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def read(self):
                return json.dumps(provider_response()).encode()
        with patch('backend.research.urlopen', return_value=Reply()) as call:
            search(self.pick, 'test-key-not-real', 'gpt-5-mini')
            request = call.call_args.args[0]
            self.assertEqual(request.full_url, 'https://api.openai.com/v1/responses')
            payload = json.loads(request.data)
            self.assertTrue(payload['tools'][0]['external_web_access'])
            self.assertEqual(payload['tools'][0]['type'], 'web_search')
            self.assertEqual(payload['tool_choice'], 'required')
            self.assertEqual(payload['max_tool_calls'], 6)
            self.assertFalse(payload['store'])
            context = json.loads(payload['input'][1]['content'])
            self.assertNotIn('stake', context)
            self.assertEqual(context['kickoff_utc'], self.pick['commence_time'])
