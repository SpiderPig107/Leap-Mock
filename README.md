# Leap+ (concept prototype)

**Try it:** **https://leap-mock.vercel.app** (best on a phone, or in a narrow browser window)

> Concept prototype — not affiliated with TFI/NTA. No real money moves. No physical Leap card is read or changed. All card numbers are fake.

Built together by **Gamaliel** and **Sona** at the **Cognition Builder's Day**, hosted by **Give(a)Go**, with Devin AI.

## Demo video

https://github.com/user-attachments/assets/beeee950-334f-4245-a74c-10d100273850

## The problem

Dublin commuters have two problems:

1. **Topping up a Leap Card is slow.** You type card details each time. Google Pay and Apple Pay are not options.
2. **The Leap app does not show your bus.** For live times and journey planning, you need a separate app.

## What Leap+ does

Leap+ puts top-up and live journeys in one app.

| Tab | What you can do |
|---|---|
| **Card** | Add a card by a simulated NFC scan or by entering its number. See the balance and recent transactions. |
| **Top Up** | Choose an amount (min €5, max balance €150) and pay with **Google Pay** (real Google Pay sheet, TEST mode), **Apple Pay** (simulated), or a saved card. |
| **Plan** | Search any place in the Republic of Ireland (shops, landmarks, stops). Compare routes by time, changes, and walking. Open a route on a map with stops, walking legs, and live buses. |
| **Live** | Follow live buses on any Dublin Bus or Go-Ahead Ireland route in Dublin: search, save and reorder up to 8 routes (E1, 39A and 16 by default). Open a stop to see arrivals. If your balance is low, top up from the stop screen (smart top-up). |

### Demo cards

| Card number | Type | Start balance |
|---|---|---|
| `300000000001` | Adult | €3.20 |
| `300000000002` | Student | €12.50 |
| `300000000003` | Adult | €0.00 |

The scan screen always loads `300000000001`.

## How it works

```
Phone browser (React app)
   │  calls only our own /api/... endpoints
   ▼
Vercel serverless functions (api/)  ── hold all keys, check every input
   ├── /api/card/get, /api/card/topup ──► Google Apps Script ──► Google Sheet (fake cards + transactions)
   ├── /api/realtime ───────────────────► NTA GTFS-Realtime API (live bus positions + delays)
   ├── /api/plan ───────────────────────► Transitous (journey planner on TFI timetables + NTA delays)
   └── /api/geocode ────────────────────► Photon (place search on OpenStreetMap data)
```

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, React Router, Zustand. Maps use Leaflet with OpenStreetMap tiles. The browser holds no secrets.
- **Backend-for-frontend:** Vercel functions in [`api/`](api). They keep `NTA_KEY` and the Sheet secret on the server, and return only the data the app needs.
- **Mock card system:** a Google Sheet with an Apps Script web app ([`apps-script/Code.gs`](apps-script/Code.gs)). Money is stored in whole cents. Each top-up has an idempotency key, so a retry never adds money twice.
- **Payments:** Google Pay runs in TEST mode through Google's official button. The app discards the payment token and never stores or sends it. Apple Pay is a simulated sheet, labelled "Simulated". Both then call the same top-up API.
- **Live buses:** the NTA GTFS-Realtime API, called by the server at most once a minute and shared by all users. If NTA is unavailable, the app replays recorded data, labelled **RECORDED**.
- **Journey planning:** [Transitous](https://transitous.org), a free open journey planner. For Ireland it uses the TFI GTFS timetables and NTA TripUpdates (delays). Leap+ adds NTA live bus positions on top.
- **Place search:** [Photon](https://photon.komoot.io) by Komoot, built on OpenStreetMap. Results are limited to the Republic of Ireland and ranked near Dublin first. Transitous search is the backup.

### What is real and what is simulated

| Real | Simulated |
|---|---|
| NTA live bus positions and delays | Card balances and transactions (Google Sheet) |
| Transitous routes and Photon place search | Apple Pay sheet |
| Google Pay sheet (TEST mode, no charge) | NFC card scan |

In production, the top-up API would send the Google Pay token to a payment provider (for example Stripe) and credit the card in the TFI card system only after the charge succeeds.

## Run it locally

```bash
npm install
cp .env.example .env.local   # fill in the values below
npx vercel dev               # Vercel CLI: runs the app and the api/ functions
```

| Variable | Purpose |
|---|---|
| `NTA_KEY` | NTA developer portal API key (server-side only) |
| `SHEET_WEBAPP_URL` | Apps Script web app URL |
| `SHEET_SHARED_SECRET` | Shared secret between Vercel and Apps Script |

Without these values, the app still runs with recorded bus data. Card features need the Sheet.

Checks: `npm test` (Vitest), `npm run lint`, `npm run build` (type check + build).

**Reset the demo balances:** open the Sheet → **Extensions → Apps Script** → select `setup` → **Run**.

## Docs

| Doc | File |
|---|---|
| PRD | [docs/01-PRD.md](docs/01-PRD.md) |
| Process Flow | [docs/02-Process-Flow.md](docs/02-Process-Flow.md) |
| Tech Spec | [docs/03-Tech-Spec.md](docs/03-Tech-Spec.md) |
| Security Review | [docs/04-Security-Review.md](docs/04-Security-Review.md) |
| Implementation Plan | [docs/05-Implementation-Plan.md](docs/05-Implementation-Plan.md) |

## Credits and data

- Transit data: Transport for Ireland / National Transport Authority (GTFS and GTFS-Realtime).
- Journey planning: [Transitous](https://transitous.org) (CC-BY-SA 4.0 data).
- Place search and maps: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, via [Photon](https://photon.komoot.io).
- Icons: [Lucide](https://lucide.dev).

Leap+ is an independent concept. It is not built, endorsed, or approved by TFI or the NTA.
