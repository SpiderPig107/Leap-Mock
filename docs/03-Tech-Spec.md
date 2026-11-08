# Tech Spec: Leap+ (Concept Prototype)

| Field | Value |
|---|---|
| Status | APPROVED v1.0 — locked (TQ1–TQ4 defaults accepted; v0.2 flowchart check included) |
| Inputs | PRD v1.0, Process Flow v1.0 (both locked) |
| Authors | Devin (Eng), reviewed by co-founder |
| Next gate | Security Review (uses section 9 as input) |

## 1. Summary

A React + Vite + TypeScript mobile web app, hosted on Vercel. Two Vercel serverless functions act as a backend-for-frontend (BFF):
- `/api/card/*` → forwards to a **Google Apps Script** web app that reads/writes a **Google Sheet** (mock Leap backend).
- `/api/realtime` → forwards to the **NTA GTFS-Realtime API**, filters to 3 routes, caches for 20 s.

Static route data (shapes, stops, today's timetable) is pre-extracted from the public TFI GTFS feed at build time. Google Pay runs in TEST mode in the browser. Apple Pay is a UI simulation. Total running cost: **€0**.

## 2. Verified facts (checked during this spec)

| Fact | Evidence |
|---|---|
| NTA GTFS-R v2 endpoints exist: `/gtfsr/v2/Vehicles`, `/gtfsr/v2/TripUpdates`, `/gtfsr/v2/gtfsr`; `?format=json` accepted | `api.nationaltransport.ie` returns 401 "missing subscription key" (endpoint live, key needed) |
| Dublin Bus GTFS static feed: 44 MB zip, updated daily | `transportforireland.ie/transitData/Data/GTFS_Dublin_Bus.zip`, last-modified 6 Nov 2026 |
| **Route 46A no longer exists.** BusConnects replaced it (E1/E2) | Not in current `routes.txt` (116 routes) |
| Highest-frequency Dublin Bus routes by trip count: E1 (1767), E2, 39A (1618), 15, N4, 27, 16 (1266) | Computed from current `trips.txt` |
| `@google-pay/button-react` latest 4.1.0; `react-leaflet` 5.0.0; `gtfs-realtime-bindings` 2.2.0 | npm registry |

**Proposed demo routes: E1, 39A, 16.** (High frequency = more live buses on the map.)

## 3. Architecture

```
┌──────────────────────── Browser (Chrome, device mode) ────────────────────────┐
│ React SPA (Vite build, static on Vercel CDN)                                   │
│  • Card/TopUp features ──fetch──► /api/card/get, /api/card/topup               │
│  • Google Pay JS (TEST) ──► Google (token returned, discarded after success)   │
│  • Apple Pay sim (pure UI)                                                     │
│  • Live feature ──poll 20 s──► /api/realtime?routes=E1,39A,16                  │
│                 └─ RECORDED mode: /recorded/*.json (static, no network to NTA) │
│  • Static: /gtfs/{route}.json (shape, stops, today's timetable)                │
│  • localStorage: savedCardNumber, dataMode                                     │
└────────────────────────────────────────────────────────────────────────────────┘
        │ HTTPS (same origin, no CORS)
┌───────▼──────────── Vercel serverless functions (Node 20) ────────────┐
│ /api/card/get     POST {cardNumber}                                    │
│ /api/card/topup   POST {cardNumber, amountCents, method, idempotencyKey}│
│   • validates input • adds SHEET_SHARED_SECRET • 8 s timeout           │
│ /api/realtime     GET ?routes=…                                        │
│   • adds NTA_KEY • filters routes • Cache-Control s-maxage=20          │
│   • on NTA error → 503 {fallback:true} → client switches to RECORDED   │
└───────┬───────────────────────────────────────────┬────────────────────┘
        │ HTTPS + shared secret                     │ HTTPS + API key header
┌───────▼──────────────────────┐        ┌───────────▼──────────────────────┐
│ Google Apps Script web app   │        │ NTA GTFS-Realtime API v2          │
│  doPost → LockService →      │        │  Vehicles, TripUpdates (JSON)     │
│  Sheet "Cards", "Transactions"│        └──────────────────────────────────┘
└──────────────────────────────┘
```

**Why a BFF (Vercel functions) instead of calling Apps Script and NTA from the browser:**
1. Secrets (NTA key, Sheet secret) never reach the browser.
2. No CORS problems. (Apps Script does not answer CORS preflight requests. The NTA API needs a key header.)
3. Server-side validation of amounts. The browser is untrusted.
4. One place to add caching and fallbacks.

## 4. Stack decisions

| Area | Choice | Alternatives considered | Reason |
|---|---|---|---|
| Frontend | React 18 + Vite + TypeScript | Next.js, plain HTML | Fast dev server; Devin and team know it; static output |
| Styling | Tailwind CSS | CSS modules, MUI | Fastest way to match Figma; no design-system lock-in |
| State | Zustand (+ `persist` for card number) | Redux, Context | Tiny API; 1 store per feature |
| Routing | React Router 6 | TanStack Router | Standard; enough for 17 screens |
| Map | Leaflet + react-leaflet + OSM tiles | Mapbox, Google Maps | No API key; free; OSM attribution required |
| Google Pay | `@google-pay/button-react` (TEST) | Stripe Payment Request | No account needed; real Google Pay sheet |
| Apple Pay | Custom React component | Apple Pay JS | Real Apple Pay needs Merchant ID + domain verification (PRD NG2) |
| Mock backend | Google Sheet + Apps Script | Supabase, SQLite, JSON file | PO decision D2; visible to judges (F14) |
| BFF + hosting | Vercel (Hobby) functions + static | Netlify, Cloudflare | Git push = deploy; preview URL per PR; env vars |
| GTFS-R parsing | NTA `?format=json` | `gtfs-realtime-bindings` (protobuf) | JSON avoids protobuf in 3 h; protobuf is the fallback if JSON shape is bad |
| Static GTFS prep | Python script (build time) | Parse in browser | Raw files are 230 MB; output is ~100–300 KB per route |
| Tests | Vitest (unit), manual E2E checklist | Playwright | Time box; unit-test only pure logic |

## 5. Frontend design

### 5.1 Folder layout
```
leap-plus/
  api/                     # Vercel functions
    card/get.ts
    card/topup.ts
    realtime.ts
    _lib/validate.ts  _lib/http.ts
  apps-script/Code.gs      # copy-paste into the Sheet's Apps Script editor
  scripts/
    extract_gtfs.py        # → public/gtfs/{E1,39A,16}.json
    record_realtime.ts     # → public/recorded/snap-000.json … (needs key)
    synth_realtime.py      # → public/recorded/* without a key (buses moved along shapes)
  public/gtfs/  public/recorded/
  src/
    app/        App.tsx, routes.tsx, TabBar.tsx, DisclaimerStrip.tsx
    ui/         Button, Sheet, Skeleton, ErrorPanel, Badge, theme tokens
    features/card/    WelcomeS01, ScanS02, EnterNumberS03, HomeS04, TransactionsS12, cardStore.ts, cardApi.ts
    features/topup/   AmountS05, MethodS06, ConfirmS07, GooglePayButton, ApplePaySimS09, ProcessingS10, SuccessS11, topupStore.ts
    features/live/    RouteMapS13, StopListS14, StopDetailS15, SmartTopUpCard, useRealtime.ts, eta.ts, interpolate.ts
    lib/        money.ts (cents), config.ts (fare, limits), ids.ts (idempotency keys)
```
Rule: component names carry the screen ID from the Process Flow. Stream 1 (P0/P1) owns `src/app`, `src/ui`, `features/card`, `features/topup`, `api/card`. Stream 2 (P2) owns `features/live`, `api/realtime.ts`, `scripts/`, `public/`.

### 5.2 Config (single source: `src/lib/config.ts`)
```ts
export const CONFIG = {
  minTopUpCents: 500,
  maxBalanceCents: 15000,
  fareCents: 200,
  smartTopUpTriggerCents: 400,
  smartTopUpAmountCents: 1000,
  amountChipsCents: [500, 1000, 2000, 3000],
  realtimePollMs: 20000,
  apiTimeoutMs: 8000,
  routes: ["E1", "39A", "16"],
};
```
All money is **integer cents**. Never floats.

### 5.3 Key behaviours
- **Saved card:** `cardNumber` in localStorage (Zustand `persist`). App start: if present → S04, else S01. Balance is always re-fetched from the API (the Sheet is the source of truth). If the re-fetch returns `CARD_NOT_FOUND` (for example after a Sheet reset), clear the saved card and go to S01.
- **Simulated scan (S02):** 2.5 s animation, then fills demo card `"300000000001"`. Demo flags force each failure branch: `?scanFail=1` (S02 failed), `?topupFail=1` (next top-up times out → S10 error / S15 error), `?liveFail=1` (LIVE → RECORDED + toast). Any unknown card number triggers the S03 error.
- **Top-up (S10):** client creates `idempotencyKey = crypto.randomUUID()` once per attempt. A retry reuses the same key. The server never applies the same key twice.
- **Google Pay:** on `onLoadPaymentData` → do not store or send the token → call `/api/card/topup` with `method: "GOOGLE_PAY"`. On `onCancel` → return to S06 with no error.
- **Smart top-up (S15):** visible when `balanceCents < smartTopUpTriggerCents`. Uses the same `topup` action as S10. Inline states: idle → processing → done/error. Error copy: "Top-up not confirmed. You were not charged." + "Try again" (same idempotency key). Google Pay cancel → back to idle with no error.

### 5.4 Google Pay request (TEST)
```ts
{
  apiVersion: 2, apiVersionMinor: 0,
  allowedPaymentMethods: [{
    type: "CARD",
    parameters: { allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"], allowedCardNetworks: ["VISA", "MASTERCARD"] },
    tokenizationSpecification: { type: "PAYMENT_GATEWAY", parameters: { gateway: "example", gatewayMerchantId: "exampleGatewayMerchantId" } },
  }],
  merchantInfo: { merchantName: "Leap+ Demo" },
  transactionInfo: { totalPriceStatus: "FINAL", totalPrice: "10.00", currencyCode: "EUR", countryCode: "IE" },
}
```
Component prop `environment="TEST"`. Needs HTTPS (Vercel) or `localhost`. The demo Chrome profile must be signed in to a Google account.

## 6. Mock backend (Google Sheet + Apps Script)

### 6.1 Sheet schema
**Tab `Cards`**
| cardNumber (text) | holderType | balanceCents | updatedAt (ISO) |
|---|---|---|---|
| 300000000001 | Adult | 320 | … |
| 300000000002 | Student | 1250 | … |
| 300000000003 | Adult | 0 | … |

**Tab `Transactions`**
| txId | cardNumber | type (TOPUP/FARE) | amountCents (+/-) | method (GOOGLE_PAY/APPLE_PAY_SIM/SAVED_CARD/—) | description | idempotencyKey | createdAt |

Seed 5 FARE/TOPUP rows per demo card. Card numbers are fake (PRD NG6). Format the `cardNumber` columns as plain text so the Sheet does not convert them to numbers.

### 6.2 Apps Script (`doPost`)
- Deploy as web app: **Execute as: Me**, **Who has access: Anyone**. (Anyone with the URL can call it, so it checks a shared secret; see the Security Review.)
- Request body: `{ secret, action: "get" | "topup", cardNumber, amountCents?, method?, idempotencyKey? }`.
- `get` → `{ cardNumber, holderType, balanceCents, updatedAt, transactions: last 5 }`.
- `topup` → `LockService.getScriptLock().waitLock(5000)` → if `idempotencyKey` already exists in Transactions, return the existing result → else validate (amount ≥ 500, new balance ≤ 15000) → update balance → append the transaction → return `{ balanceCents, txId, createdAt }`.
- Errors: `{ error: "CARD_NOT_FOUND" | "INVALID_AMOUNT" | "BALANCE_CAP" | "UNAUTHORIZED" | "BUSY" }`.
- Latency: about 1–2 s per call (Apps Script cold start). The UI shows a loading state.

### 6.3 BFF contracts (browser ↔ Vercel)
```ts
// POST /api/card/get
type GetCardReq = { cardNumber: string };                 // /^\d{12,19}$/
type GetCardRes = { cardNumber: string; holderType: "Adult" | "Student"; balanceCents: number;
                    updatedAt: string; transactions: Tx[] };
// POST /api/card/topup
type TopUpReq = { cardNumber: string; amountCents: number; method: "GOOGLE_PAY" | "APPLE_PAY_SIM" | "SAVED_CARD";
                  idempotencyKey: string };              // uuid
type TopUpRes = { balanceCents: number; txId: string; createdAt: string };
type Tx = { txId: string; type: "TOPUP" | "FARE"; amountCents: number; description: string; createdAt: string };
type ApiError = { error: "CARD_NOT_FOUND" | "INVALID_AMOUNT" | "BALANCE_CAP" | "UPSTREAM_TIMEOUT" | "BAD_REQUEST" };
```
The BFF validates every field, rejects unknown fields, and maps Apps Script errors to HTTP 400/404/409/504.

## 7. Live bus data

### 7.1 Static (build time): `scripts/extract_gtfs.py`
Input: `GTFS_Dublin_Bus.zip` and `GTFS_GoAhead.zip`. For every route with at least half its stops in Dublin (157 routes), and each direction:
- `shape`: one representative polyline (most common `shape_id`), simplified to ~200 points.
- `stops`: ordered list `{stopId, code, name, lat, lon}`.
- `timetable`: for the **demo date only** (filtered by `calendar.txt` + `calendar_dates.txt`): per trip `{tripId, startSecs, stopOffsetsSecs[]}`.
Output: `public/gtfs/{route}.json` (target < 300 KB each), `public/gtfs/index.json` (route list for the Live route picker) and `api/_lib/routeIds.ts` (route_id lookup for the realtime proxy). Run it on the demo morning so the trip IDs match the live feed.

### 7.2 Realtime: `/api/realtime?routes=E1,39A,16`
- Calls `Vehicles?format=json` and `TripUpdates?format=json` in parallel. Sends the key header given in the NTA developer portal docs. (Verify the exact header name when the key arrives.)
- Maps GTFS `route_id` → short name with a lookup that the extract script generates.
- Response (small, client-friendly):
```ts
type RealtimeRes = {
  source: "LIVE"; fetchedAt: string;
  vehicles: { vehicleId: string; route: string; tripId: string; lat: number; lon: number; bearing?: number; ts: number }[];
  tripDelays: Record<string /*tripId*/, { delaySecs: number; stopSeq?: number }>;
};
```
- Cache: `Cache-Control: s-maxage=20, stale-while-revalidate=40`. All viewers share one NTA call per 20 s, which protects the rate limit.
- On NTA error or timeout (5 s): HTTP 503 `{ fallback: true }`.

### 7.3 ETA logic (`eta.ts`, unit-tested)
For a stop on route R: take today's trips that have not yet passed the stop. `scheduled = tripStart + stopOffset`. If `tripDelays[tripId]` exists: `eta = scheduled + delaySecs`, tag **Live**. Else tag **Scheduled**. Show the next 3.

### 7.4 Data modes
- **LIVE:** polls the BFF every 20 s.
- **RECORDED:** loops through `public/recorded/snap-*.json` (same `RealtimeRes` shape, `source: "RECORDED"`), one snapshot per 20 s.
- **Auto-fallback:** on a 503 or network error → switch to RECORDED + toast (Process Flow S13 fallback state).
- **No key yet:** `synth_realtime.py` creates snapshots by moving fake vehicles along each shape at about 18 km/h. Replace them with real recordings when the key arrives (`record_realtime.ts`, 10 min = 30 snapshots).
- **Marker animation (F13):** linear interpolation between the last 2 positions over 20 s with `requestAnimationFrame`.

## 8. Error handling summary

| Failure | Detection | User sees |
|---|---|---|
| Apps Script slow/down | BFF 8 s timeout → 504 | S10 error "Top-up not confirmed. You were not charged." + Try again (same idempotency key) |
| Card not found | 404 | S03 inline error |
| Amount out of range | Client check + server 400/409 | S05 inline error |
| Google Pay unavailable | `isReadyToPay` false | Google Pay button hidden |
| Saved card missing in Sheet | 404 on app-start re-fetch | Clear saved card → S01 |
| Backend rejects after wallet success (`BALANCE_CAP`, `INVALID_AMOUNT`) | 400/409 | S10 error "Top-up not completed. You were not charged." + "Change amount" → S05 |
| Smart top-up fails | 504 / network | S15 inline error + "Try again" (same idempotency key) |
| NTA down / no key | 503 / 401, at Live tab entry **or on any later poll** | Auto-switch to RECORDED + toast. Retry LIVE every 60 s; switch back silently on success |
| Map tiles fail | Leaflet tile error | Route line + markers on a grey background (still usable) |

## 8b. Flow conformance (FigJam flowchart "Leap+ user flows", reviewed v0.2)

| Flowchart element | Tech Spec mapping | Status |
|---|---|---|
| A: Card saved? → S04 | 5.3 Saved card (localStorage) + re-fetch | Match. Added: 404 on re-fetch → S01 |
| A: Card read OK? → S02 failed → Try again / Enter number | 5.3 `?scanFail=1` | Match |
| A: Our API: get card → Card found? | `POST /api/card/get`, 404 `CARD_NOT_FOUND` | Match |
| A: Save card on device | Zustand `persist` | Match |
| B: Amount valid? (min €5, balance ≤ €150) | `CONFIG` + client check + server check | Match. Added: server reject after wallet success |
| B: Payment method → S07 / S08 / S09 | S06 component order: Google Pay, Apple Pay, saved card | Match |
| B: Paid? / Confirmed? → Cancelled → S06 | `onCancel`; Apple Pay sim close | Match |
| B: Our API: top up → Confirmed within 8 s? | BFF 8 s timeout → 504 | Match |
| B: S10 error → Try again → S10 | Same idempotency key | Match |
| C: LIVE data available? → LIVE / RECORDED + toast | `/api/realtime` 503 → RECORDED | Match. Spec also covers a failure **after** entry (not drawn) |
| D: Balance < €4.00? → card / arrivals + fare only | `smartTopUpTriggerCents: 400` | Match |
| D: Paid? → Our API: top up → topped up / Cancelled → S15 | Same `topup` action | Match. **Not drawn:** API failure after payment → S15 inline error + Try again |

Flowchart gaps: none block the build. 2 optional additions to the drawing: (1) D: "Our API: top up" → "Confirmed within 8 s?" → No → "S15 error: Try again"; (2) A: "S04 Home" re-fetch → "Card found?" → No → "S01".

## 9. Security design (input to Security Review)

- Secrets only in Vercel env vars: `NTA_KEY`, `SHEET_WEBAPP_URL`, `SHEET_SHARED_SECRET`. Never prefixed `VITE_` (Vite exposes `VITE_*` vars to the browser).
- Google Pay token: never stored, logged, or sent. TEST mode only.
- No real personal data. Fake card numbers only.
- Server-side validation of all inputs (regex, integer cents, ranges, method enum, UUID).
- Idempotency key prevents double top-ups on retry.
- `LockService` prevents lost updates when two top-ups run at the same time.
- Basic security headers via `vercel.json`: CSP (allow `pay.google.com`, OSM tiles, self), `X-Content-Type-Options`, `Referrer-Policy`.
- Known demo-grade gaps (accepted risk, to be listed in the Security Review): no user authentication, so anyone with the URL can top up a fake card; Apps Script web app URL is public but secret-gated; no rate limiting on `/api/card/*`.

## 10. Cost

| Item | Cost |
|---|---|
| Vercel Hobby (static + functions) | €0 |
| Google Sheet + Apps Script | €0 (quotas far above demo use) |
| NTA GTFS-R API key | €0 |
| OSM tiles | €0 (light use; attribution shown) |
| Google Pay TEST | €0 |
| **Total** | **€0** |

## 11. Testing strategy

- **Unit (Vitest):** `money.ts`, amount validation, `eta.ts`, idempotency handling in the BFF. Target: about 15 tests, < 5 s.
- **Contract:** one `curl` script per BFF endpoint (happy path + 1 error each).
- **Manual E2E checklist:** Process Flow flows A–F on Chrome device mode (iPhone 14 + Pixel 7). Run it after each merge and at code freeze.
- **Demo-readiness:** Lighthouse mobile run; no console errors; RECORDED mode tested with Wi-Fi off.

## 12. Open questions (proposed defaults — PO to accept or change)

1. **TQ1.** Demo routes: **E1, 39A, 16** (replaces 46A, which no longer exists).
2. **TQ2.** Demo card numbers: **300000000001 (Adult, €3.20), 300000000002 (Student, €12.50), 300000000003 (Adult, €0.00)**.
3. **TQ3.** Who owns the Vercel and Google accounts for the demo? Default: **co-founder's accounts** (she is QA/Ops).
4. **TQ4.** GTFS-R format: **JSON first**, protobuf only if JSON fails.
