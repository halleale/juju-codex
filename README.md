# Edgebook

An **Expo Go app for NFL pre-game moneyline recommendations and result tracking**, with a Python 3.12+ API and SQLite storage. An earlier SwiftUI frontend remains in `ios/` as an optional alternative.

## Run with Expo Go (recommended)

**[Download the SDK 57 project ZIP](https://github.com/halleale/juju-codex/raw/refs/heads/main/downloads/edgebook-sdk57.zip)**. Unzip it to get the `edgebook-sdk57` folder, then open its `mobile` folder in Terminal. This source archive excludes installed dependencies, credentials, and local tracker records.

Install Node.js 22.13+ (Node 24 recommended) on your computer and the current **Expo Go** app on your iPhone. From the checkout:

```sh
cd mobile
npm ci
npm start
```

Keep your phone and computer on the same Wi-Fi. Scan the terminal QR code with the iPhone Camera and open it in Expo Go. No Mac, Xcode, signing, Expo account, or odds key is required for the default on-device demo. This app uses **Expo SDK 57**, the physical-device version recommended in [Expo's setup documentation](https://docs.expo.dev/get-started/create-a-project/) during the SDK 58 transition. All native dependencies match SDK 57's bundled versions; no custom development build is required.

If you downloaded the earlier SDK 58 project and Expo Go says it requires a newer version, updating Expo Go again will not fix the project. Stop Metro with **Control+C**, download the updated project into a new folder (preserving the previous folder), run `npm ci` in its `mobile/` folder, then run `npm start -- --clear`. Scan the new QR code. Do not reopen the earlier project from Expo Go's recent history. If you use Git, pull the update instead of downloading another ZIP.

The demo includes fictional NFL prices, expected-value explanations, stake tracking, manual settlement, and ROI. Demo records persist on the device using AsyncStorage. Uninstalling Expo Go or clearing its app data can erase them. The demo uses no backend and never submits a wager. These are illustrative examples, not live recommendations.

### Connect to the Python API

Start the backend on your computer from the repository root. On macOS/Linux:

```sh
EDGEBOOK_HOST=0.0.0.0 python3 -m backend.server
```

On Windows PowerShell, set `$env:EDGEBOOK_HOST="0.0.0.0"`, then run `python -m backend.server`.

In the Expo app, choose **Settings**, enter your computer's LAN address (for example `http://192.168.1.20:8000`), and tap **Connect to backend**. Allow Expo Go local-network access if iOS asks, and allow port 8000 through your computer's firewall only on your trusted private network. `localhost` on a physical phone means that phone, not your computer or this cloud workspace.

Without a provider key, the backend also returns explicitly labeled demo prices. Set `ODDS_API_KEY` securely in the backend process and restart it for live prices; never use `EXPO_PUBLIC_` variables for provider credentials. On-device demo records, backend demo records, and backend live performance stay separate. Connection errors do not silently switch to demo mode.

Expo's optional `npm start -- --tunnel` tunnels **Metro only**, not the Python API. A cloud Metro address is not automatically reachable from your phone. For immediate use, run on your own computer as above. A hosted API needs HTTPS, authentication, and per-user storage before public exposure.

### Validate the Expo app

From `mobile/`:

```sh
npm run typecheck
npm test
npm run export:ios
```

The tests require Node 22.13+ and Python 3.12+ and cover demo tracking, stake validation, ROI, and actual client-to-backend tracking and settlement. The iOS JavaScript/Hermes bundle has been exported successfully in Linux. That does not establish a physical-device test; opening and interacting in Expo Go still needs verification on an iPhone.

In this managed cloud environment, use `npm --cache /workspace/.npm-cache ci`. Expo's remote metadata services are restricted here; `CI=1 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 npm start -- --localhost` uses the SDK's installed configuration for local Metro validation, and the same environment flags work for `npm run export:ios`. This does not provide a phone-accessible cloud QR link.

## Run the API

From the existing checkout (cloud tasks are isolated; do not create a worktree):

```sh
cd /workspace/juju-codex
python3 -m unittest discover -s backend/tests -v
python3 -m backend.server
```

The API binds to `127.0.0.1:8000`; `GET /health` returns `{"status":"ok"}`. `GET /recommendations` returns a source label and picks. State is saved in the ignored `.local/edgebook.sqlite3`. Override `EDGEBOOK_DB` to use a different database path, `PORT` to use a different port, and `EDGEBOOK_HOST` to bind another interface.

Without `ODDS_API_KEY`, data is explicitly fictional. To use live prices, set that variable securely in the backend process using a key from **The Odds API**, then restart. Outbound access to `api.the-odds-api.com` is needed. Never put provider credentials in the app or commit them. Odds are cached for 60 seconds to reduce quota usage; provider failures surface as errors, never silent demo substitution. Live access and quotas have not been validated yet.

## Optional SwiftUI app (Mac required)

Install Xcode 15+ and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`), then:

```sh
cd ios
xcodegen generate
open Edgebook.xcodeproj
```

Select an iPhone simulator and run. Start the Python backend on **that Mac** from the checkout root with `EDGEBOOK_DB="$PWD/.local/edgebook.sqlite3" python3 -m backend.server`. The simulator's default API address is `http://localhost:8000`. It cannot use localhost to reach a backend on a different cloud machine.

For a physical iPhone on your trusted LAN, set `EDGEBOOK_HOST=0.0.0.0` when starting the Mac's API and set the app's Method → API base URL to `http://your-mac.local:8000`. Choose your own signing team and bundle identifier in Xcode. The project allows local networking, not arbitrary HTTP Internet access. Stop LAN sharing when finished. This development API is single-user and has no authentication; do not expose it to the public Internet. A deployed API requires HTTPS, authentication, and per-user storage.

The Linux cloud machine cannot compile SwiftUI or run the iOS simulator. iOS compilation and device behavior remain unverified until tested in Xcode.

## What the estimate means

In the Expo app, tap **Why this pick? Research & analysis** on a recommendation. **Quick read** explains the price and game-research takeaways in plain language. **Deep dive** adds the reference quotes, probability calculations, historical sample sizes, source details and sensitivity checks. The report includes:

- Why the offered price meets the selection rule, with break-even chance, consensus estimate, and probability difference shown separately from EV.
- Estimated fair moneyline, minimum whole-number moneyline for the 2% EV screen, and win/loss versus expected return per 100 units.
- Each reference book's two-sided prices, quote timestamp, implied probability, market overround, and normalized probability after removing margin.
- An arithmetic reconciliation of reference prices with the reported median and EV. This is not a predictive-confidence rating or an authentication of the provider.
- Hypothetical sensitivity checks with win probability two percentage points lower/higher; reference-book dispersion is explicitly not a statistical confidence interval.
- The actual model inputs, missing injury/weather/team-form inputs, lack of historical validation, and reasons the apparent edge could disappear.

On-device demo picks include fictional reference quotes and explicitly simulated price history, plus a checklist showing what live research will examine. No current injuries, weather or historical records are invented for demo games. The backend includes the same price evidence for demo and live feeds. Older backends remain compatible but cannot provide the new research endpoint until updated. Research reports cover the currently displayed recommendation; they are not archived with tracker records in this version.

For each two-outcome market, implied probability is `1 / decimal_odds`; normalize the pair to sum to one to remove margin. Exclude the offering book, then use the median normalized probability of at least three other books. Estimated expected return per staked unit is `probability * decimal_odds - 1`. Show positive estimates of at least 2%, excluding started events and quotes older than 15 minutes. No staking recommendation is made.

This is a **market-consensus price screen**, not a trained forecasting agent. Correlated books, slow quotes, limits, and estimation error can erase an apparent edge. It has no validated profitability claim. A future predictive model needs historical odds, injury/team data, time-correct features, out-of-sample calibration and backtesting, and closing-line evaluation before claiming an advantage. Web research is separate context; it does not change the probability or EV calculation.

## Live web research with OpenAI

The server integrates the [OpenAI Responses API web-search tool](https://developers.openai.com/api/docs/guides/tools-web-search). It requests live search (`web_search`, external web access enabled) and structured output for five topics: team form/efficiency, injuries, weather/venue, rest/travel/matchup situations, and historical statistics. The default model is `gpt-5-mini`; override `EDGEBOOK_RESEARCH_MODEL` only with a model supporting both web search and strict JSON-schema output.

**Required for live use:** securely configure `ODDS_API_KEY` and `EDGEBOOK_RESEARCH_API_KEY` on the Python backend. An OpenAI API account with billing and model access is required; ChatGPT subscriptions do not include API usage. The backend also accepts the conventional `OPENAI_API_KEY` on local machines, but the managed cloud platform reserves that prefix, so its saved secret requirement uses `EDGEBOOK_RESEARCH_API_KEY`. Never put keys into the mobile app or `EXPO_PUBLIC_` variables.

For a local Mac, from a Terminal in the repository root, the following zsh prompts read keys without echoing them or putting their values in command history:

```zsh
read -s "ODDS_API_KEY?Odds provider API key: "
export ODDS_API_KEY
printf '\n'
read -s "EDGEBOOK_RESEARCH_API_KEY?OpenAI API key: "
export EDGEBOOK_RESEARCH_API_KEY
printf '\n'
EDGEBOOK_HOST=0.0.0.0 python3 -m backend.server
```

Connect the Expo app to that Mac's LAN API address as described above. Actual live odds are needed: fictional demo games never trigger paid OpenAI searches. In the pick's report, tap **Search latest context**. Opening the report only checks history/status; it does not automatically initiate an OpenAI call. Searches can take around 90 seconds. On your trusted LAN this is still a single-user prototype: the research endpoint has no account authentication and must not be exposed publicly.

Results include clickable source links, retrieval time, reported source context date when available, available historical periods/sample sizes, and separate uncertain/unavailable labels. The backend accepts claim URLs only if they match sources actually returned by web search (or opened search pages). Unsupported sections have their text and numbers replaced with an unavailable message. A matching source URL is **not** independent verification that every statement is entailed by its page. AI summaries can still be inaccurate; users should check sources and dates. The prompt asks for primary sources, timing/venue-aware weather forecasts, historical sample-size caveats, contrary evidence and no unsupported sharp-money or causal claims.

Responses are cached in memory for 15 minutes per game/selection/model. The default persistent rate limit is six new attempts per rolling hour, including failed attempts; set `EDGEBOOK_RESEARCH_MAX_PER_HOUR` to 1–60 if needed. Requests cap built-in tool calls at six and output at 6,500 tokens. These are usage controls, not an exact dollar spending cap; set appropriate provider-side spending controls too. Cache contents are lost on restart, while the hourly-attempt counter persists in SQLite.

`GET /research?pick_id=<encoded ID>` returns status, history and any cached report without a paid search. `POST /research` with `{"pick_id":"..."}` explicitly requests one. Missing credentials return `needs_config`. Demo returns `demo`. Provider errors do not invent results or change the price model. The backend sends matchup, selection, kickoff and request time to OpenAI, not tracker stakes or account information. Responses use `store: false`; provider retention policies still apply.

Live OpenAI and odds-provider access remain **unverified until valid credentials are supplied**. Automated provider-boundary and HTTP tests use explicit fixtures, not real searches. Test live model compatibility, source quality, billing and device behavior after configuration.

## Price trend history

Each live recommendation refresh records all eligible two-sided prices in SQLite, even if a particular quote does not qualify as a pick. Records are keyed by event, book, selection and the vendor's quote timestamp. Repeated polling of an unchanged quote does not create fake movement. Demo records never enter live history.

The report charts implied probability for the offering book and shows first/latest price, change in break-even probability, observation coverage and best recorded payout. The displayed window contains at most the latest 120 captured quotes. One quote is labeled **collecting**, not a trend. Coverage starts when this backend observes prices; it is **not the market opening line**, provider historical coverage or a continuous background feed. Keep the database and refresh prices over time to collect history. Observation-order spacing is labeled because time gaps may differ. No injury cause, sharp-money signal or public betting percentage is inferred from movement alone.

## Tracking

Track a recommendation with a stake in consistent units; no wager is placed. Record won/lost/push manually. Profits use the stored price; ROI is net profit divided by settled stakes, including pushes. Demo and live records are shown separately. Settlement is final in this prototype. Tracking the same event/book/selection twice is rejected. The local tracker is a research record, not verified sportsbook performance.

## Remaining product work

- Validate the Expo app in Expo Go on an iPhone; add app icons and production signing for distribution. The optional SwiftUI target also needs an Xcode build check.
- Configure and verify live odds access; evaluate provider licensing and refresh quotas.
- Configure and verify live OpenAI research, source quality and billing; fixture tests do not establish live model access or accuracy.
- Add historical backtests and calibration before offering predictive-model recommendations.
- Add account authentication, secure hosting, per-user storage, automated result ingestion and settlement correction.
- Review App Store and jurisdiction requirements before public distribution.
