import SwiftUI

struct Pick: Codable, Identifiable {
    let id: String
    let matchup: String
    let selection: String
    let book: String
    let american_odds: Double
    let probability: Double
    let expected_value: Double
    let reference_books: Int
    let commence_time: String
    let updated_at: String
}

struct Feed: Codable {
    let source: String
    let generated_at: String
    let methodology: String
    let picks: [Pick]
}

struct TrackedBet: Codable, Identifiable {
    let id: Int
    let matchup: String
    let selection: String
    let book: String
    let american_odds: Double
    let stake: Double
    let source: String
    let status: String
    let profit: Double
}

struct APIError: Decodable { let error: String }

@MainActor
final class Model: ObservableObject {
    @Published var feed: Feed?
    @Published var bets: [TrackedBet] = []
    @Published var error: String?
    @Published var loading = false
    @Published var saving = false
    @AppStorage("apiURL") var apiURL = "http://localhost:8000"

    private func request(_ path: String, body: [String: Any]? = nil) async throws -> Data {
        guard let base = URL(string: apiURL), ["http", "https"].contains(base.scheme ?? ""),
              base.host != nil,
              let url = URL(string: apiURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path)
        else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(APIError.self, from: data))?.error ?? "API request failed"
            throw NSError(domain: "Edgebook", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        }
        return data
    }

    func refresh() async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            feed = try JSONDecoder().decode(Feed.self, from: await request("/recommendations"))
            bets = try JSONDecoder().decode([TrackedBet].self, from: await request("/bets"))
        } catch {
            feed = nil // Do not leave old recommendations actionable after a failed refresh.
            self.error = error.localizedDescription
        }
    }

    func track(_ pick: Pick, stake: Double) async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        do {
            _ = try await request("/bets", body: ["pick_id": pick.id, "stake": stake])
            await refresh()
        } catch { self.error = error.localizedDescription }
    }

    func settle(_ bet: TrackedBet, result: String) async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        do {
            _ = try await request("/settle", body: ["bet_id": bet.id, "status": result])
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
}

@main
struct EdgebookApp: App {
    @StateObject private var model = Model()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model).tint(.mint).preferredColorScheme(.dark)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var model: Model
    var body: some View {
        TabView {
            PicksView().tabItem { Label("NFL edges", systemImage: "chart.line.uptrend.xyaxis") }
            TrackerView().tabItem { Label("My tracker", systemImage: "list.bullet.rectangle") }
            SettingsView().tabItem { Label("Method", systemImage: "slider.horizontal.3") }
        }
        .task { await model.refresh() }
        .alert("Unable to complete request", isPresented: Binding(
            get: { model.error != nil }, set: { if !$0 { model.error = nil } }
        )) { Button("OK") { model.error = nil } } message: { Text(model.error ?? "") }
    }
}

struct PicksView: View {
    @EnvironmentObject var model: Model
    @State private var selected: Pick?
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Find the price.\nUnderstand the edge.")
                        .font(.largeTitle.bold())
                    Text("NFL • PRE-GAME MONEYLINES")
                        .font(.caption.weight(.semibold)).foregroundStyle(.mint)
                    if let feed = model.feed {
                        Label(feed.source == "demo" ? "DEMO DATA · Illustrative picks only" : "LIVE ODDS · Consensus estimates", systemImage: "info.circle")
                            .font(.callout).foregroundStyle(feed.source == "demo" ? .orange : .mint)
                        Text("Updated \(displayDate(feed.generated_at))").font(.caption).foregroundStyle(.secondary)
                        if feed.picks.isEmpty {
                            ContentUnavailableView("No qualifying edges", systemImage: "line.3.horizontal.decrease", description: Text("No current price meets the 2% estimated value and three-reference-book requirements."))
                        }
                        ForEach(feed.picks) { pick in
                            VStack(alignment: .leading, spacing: 14) {
                                Text(pick.matchup).font(.subheadline).foregroundStyle(.secondary)
                                HStack {
                                    Text(pick.selection).font(.title3.bold())
                                    Spacer()
                                    Text(oddsText(pick.american_odds)).font(.title2.monospacedDigit().bold())
                                }
                                HStack {
                                    metric("Est. EV", String(format: "+%.1f%%", pick.expected_value * 100))
                                    Spacer()
                                    metric("Consensus", String(format: "%.1f%%", pick.probability * 100))
                                    Spacer()
                                    metric("References", "\(pick.reference_books) books")
                                }
                                Text("\(pick.book) · \(displayDate(pick.commence_time))").font(.caption).foregroundStyle(.secondary)
                                Text("Quote: \(displayDate(pick.updated_at))").font(.caption2).foregroundStyle(.secondary)
                                Button { selected = pick } label: {
                                    Text("Track recommendation").frame(maxWidth: .infinity)
                                }.buttonStyle(.borderedProminent)
                            }
                            .padding(20).background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 20))
                        }
                        Text("Consensus can be wrong. Estimated value is not a guarantee of profit. Verify prices before acting.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else if model.loading {
                        ProgressView("Loading NFL prices…")
                    } else {
                        ContentUnavailableView("Connect your data", systemImage: "wifi.exclamationmark", description: Text("Set your API address in Method, then refresh."))
                        Button("Retry") { Task { await model.refresh() } }
                    }
                }.padding(20)
            }
            .navigationTitle("Edgebook")
            .refreshable { await model.refresh() }
            .sheet(item: $selected) { pick in TrackSheet(pick: pick) }
        }
    }

    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.subheadline.bold()).foregroundStyle(.mint)
        }
    }
}

struct TrackSheet: View {
    @EnvironmentObject var model: Model
    @Environment(\.dismiss) var dismiss
    let pick: Pick
    @State private var stake = "1"
    var body: some View {
        NavigationStack {
            Form {
                Section("Track a recommendation") {
                    Text(pick.selection).font(.headline)
                    Text("\(pick.book) · \(oddsText(pick.american_odds))")
                    TextField("Stake in units", text: $stake).keyboardType(.decimalPad)
                }
                Section {
                    Text("This records your selection only. No wager is placed. Use consistent units to measure results.")
                    Button("Save to tracker") {
                        Task {
                            await model.track(pick, stake: Double(stake) ?? 0)
                            if model.error == nil { dismiss() }
                        }
                    }.disabled(model.saving || (Double(stake) ?? 0) <= 0 || (Double(stake) ?? 0) > 10000)
                }
            }
            .navigationTitle("Track pick")
            .toolbar { Button("Cancel") { dismiss() } }
        }
    }
}

struct TrackerView: View {
    @EnvironmentObject var model: Model
    @State private var source = "live"
    var filtered: [TrackedBet] { model.bets.filter { $0.source == source } }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Data source", selection: $source) {
                        Text("Live").tag("live")
                        Text("Demo").tag("demo")
                    }.pickerStyle(.segmented)
                    let settled = filtered.filter { $0.status != "pending" }
                    let profit = settled.reduce(0) { $0 + $1.profit }
                    let staked = settled.reduce(0) { $0 + $1.stake }
                    LabeledContent("Net result", value: String(format: "%+.2f units", profit))
                    LabeledContent("ROI on settled stakes", value: staked > 0 ? String(format: "%+.1f%%", profit / staked * 100) : "—")
                    LabeledContent("Pending", value: "\(filtered.filter { $0.status == "pending" }.count)")
                }
                Section("Tracked recommendations · Manual results") {
                    if filtered.isEmpty { Text("Track a pick to start measuring results.").foregroundStyle(.secondary) }
                    ForEach(filtered) { bet in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(bet.selection).font(.headline)
                            Text(bet.matchup).font(.caption).foregroundStyle(.secondary)
                            Text("\(bet.book) · \(oddsText(bet.american_odds)) · \(bet.stake, specifier: "%.2f") units").font(.caption)
                            if bet.status == "pending" {
                                Menu("Record result") {
                                    ForEach(["won", "lost", "push"], id: \.self) { result in
                                        Button(result.capitalized) { Task { await model.settle(bet, result: result) } }
                                    }
                                }.disabled(model.saving)
                            } else {
                                Text("\(bet.status.capitalized) · \(bet.profit, specifier: "%+.2f") units")
                                    .foregroundStyle(bet.profit >= 0 ? .mint : .orange)
                            }
                        }.padding(.vertical, 6)
                    }
                }
            }
            .navigationTitle("My tracker")
            .refreshable { await model.refresh() }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var model: Model
    var body: some View {
        NavigationStack {
            Form {
                Section("Data connection") {
                    TextField("API base URL", text: $model.apiURL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Button("Connect & refresh") { Task { await model.refresh() } }
                    Text("Use localhost for an API on your simulator's Mac, or your Mac's local hostname on a trusted network. API credentials stay on the backend.").font(.caption)
                }
                Section("How an edge is calculated") {
                    Text("1. Convert both sides of each book's moneyline to implied probabilities.")
                    Text("2. Normalize each pair to remove the bookmaker margin.")
                    Text("3. Take the median estimate from at least three other books, excluding the book offering the price.")
                    Text("4. Estimated EV = consensus probability × decimal odds − 1. Show prices with at least 2% estimated EV.")
                    Text("Only pre-game NFL moneylines with quotes at most 15 minutes old are considered.")
                }
                Section("Know the limits") {
                    Text("Market consensus is a pricing reference, not an independently trained prediction model. This prototype has no demonstrated out-of-sample profitability.")
                    Text("Demo picks are fictional. Results are entered manually. Live and demo records stay separate.")
                    Text("For adults of legal betting age where permitted. Set limits and never chase losses. In the US, call 1-800-GAMBLER for support.")
                }
            }.navigationTitle("Method & settings")
        }
    }
}

func oddsText(_ value: Double) -> String { String(format: "%+.0f", value) }

func displayDate(_ value: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var date = formatter.date(from: value)
    if date == nil {
        formatter.formatOptions = [.withInternetDateTime]
        date = formatter.date(from: value)
    }
    return date?.formatted(date: .abbreviated, time: .shortened) ?? value
}
