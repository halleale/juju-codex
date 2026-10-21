# Edgebook

An **Expo Go app for NFL pre-game moneyline recommendations and result tracking**, with a Python 3.12+ API and SQLite storage. An earlier SwiftUI frontend remains in `ios/` as an optional alternative.

## Run with Expo Go (recommended)

Install Node.js 22.13+ (Node 24 recommended) on your computer and the current **Expo Go** app on your iPhone. From the checkout:

```sh
cd mobile
npm ci
npm start
```

Keep your phone and computer on the same Wi-Fi. Scan the terminal QR code with the iPhone Camera and open it in Expo Go. No Mac, Xcode, signing, Expo account, or odds key is required for the default on-device demo. This app uses Expo SDK 58; Expo Go must support that SDK. All native dependencies are Expo Go-compatible modules; no custom development build is required.

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

For each two-outcome market, implied probability is `1 / decimal_odds`; normalize the pair to sum to one to remove margin. Exclude the offering book, then use the median normalized probability of at least three other books. Estimated expected return per staked unit is `probability * decimal_odds - 1`. Show positive estimates of at least 2%, excluding started events and quotes older than 15 minutes. No staking recommendation is made.

This is a **market-consensus price screen**, not a trained forecasting agent. Correlated books, slow quotes, limits, and estimation error can erase an apparent edge. It has no validated profitability claim. A future predictive model needs historical odds, injury/team data, time-correct features, out-of-sample calibration and backtesting, and closing-line evaluation before claiming an advantage. No injury or team-stat inputs are included yet.

## Tracking

Track a recommendation with a stake in consistent units; no wager is placed. Record won/lost/push manually. Profits use the stored price; ROI is net profit divided by settled stakes, including pushes. Demo and live records are shown separately. Settlement is final in this prototype. Tracking the same event/book/selection twice is rejected. The local tracker is a research record, not verified sportsbook performance.

## Remaining product work

- Validate the Expo app in Expo Go on an iPhone; add app icons and production signing for distribution. The optional SwiftUI target also needs an Xcode build check.
- Configure and verify live odds access; evaluate provider licensing and refresh quotas.
- Add historical backtests and calibration before offering predictive-model recommendations.
- Add account authentication, secure hosting, per-user storage, automated result ingestion and settlement correction.
- Review App Store and jurisdiction requirements before public distribution.
