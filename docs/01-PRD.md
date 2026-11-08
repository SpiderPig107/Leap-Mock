# PRD: Leap+ (Concept Prototype)

| Field | Value |
|---|---|
| Status | APPROVED v1.0 — locked |
| Owner | Product Owner (you) |
| Contributors | Co-founder (QA/Ops), Devin (Engineering) |
| Build window | 3 hours, then live demo |
| Audience | Hackathon judges |
| Disclaimer | Concept prototype. Not affiliated with TFI or NTA. |

## 1. Problem

The TFI Leap Top Up app has two gaps:

1. **Payment friction.** Users type card details to top up. The app does not support Google Pay or Apple Pay. Wallet payments are the standard for mobile checkout.
2. **Context switch.** Users top up in one app and check live buses in another (TFI Live). They do not know if their balance covers the next trip until they tap on the bus.

## 2. Goal

Show that one app can (a) top up a Leap card with a wallet in fewer taps and (b) show live buses, and that combining both prevents a "low balance at the bus door" moment.

**Approach: full functional clone with our own mock backend.** TFI/NTA systems are not used for card data. A Google Sheet (via a Google Apps Script web API) acts as the "Leap backend". It stores fake cards, balances, and transactions. The app sends the card number to our API, not to TFI. Only live bus data uses the public NTA feed.

## 3. Non-goals

- NG1. Write credit to a physical Leap card. (MIFARE DESFire keys belong to the NTA. A web app has no access.)
- NG2. Take real money. Google Pay runs in TEST mode. Apple Pay is simulated.
- NG3. Journey planning (A to B).
- NG4. User accounts, login, production database. (The Google Sheet is a demo store only.)
- NG6. Real Leap card numbers or personal data. All cards in the Sheet are made up.
- NG5. Production-grade accessibility audit. (We meet basic contrast and tap-target size only.)

## 4. Target user

**Primary: daily Dublin Bus commuter.** Uses Leap. Has Google Pay or Apple Pay on the phone. Checks bus times before leaving home. Pain: forgets to top up; types card numbers on a small screen.

## 5. User stories

| ID | As a… | I want to… | So that… | Priority |
|---|---|---|---|---|
| US1 | commuter | see my Leap card balance on the home screen | I know if I must top up | P0 |
| US2 | commuter | pick a top-up amount (€5/€10/€20/€30/custom) | I control the spend | P0 |
| US3 | Android user | pay with Google Pay | I do not type card details | P1 |
| US4 | iPhone user | pay with Apple Pay | I do not type card details | P1 |
| US5 | commuter | see a clear success screen and the new balance | I trust the top-up worked | P0 |
| US6 | commuter | see live buses on a map for my route | I know where my bus is | P2 |
| US7 | commuter | see the next arrivals at my stop | I know when to leave | P2 |
| US8 | commuter | get a top-up prompt when my balance is below the fare | I do not get stuck at the bus door | P2 |
| US9 | demo presenter | switch between LIVE and RECORDED data | the demo works without Wi-Fi or API key | P2 |
| US10 | commuter | see my last 5 transactions | I can check each top-up | P0 |
| US11 | demo presenter | show the backend Sheet update live next to the app | judges see a real round-trip | P1 |

## 6. Scope and phasing

Priority order is fixed: P0 → P1 → P2. Each phase has a hard stop (minutes from build start). Humans review in priority order. Devin builds P2 in parallel from minute 0, because P2 is a separate tab and folder.

### P0 — Clone (hard stop 1:00)
- **F1 Home:** Leap card visual, balance, "Top Up" CTA, bottom nav (Card / Top Up / Live). Look matches the current Leap Top Up app (green brand).
- **F2 Card identification:** "Hold your Leap card to the phone" screen (simulated NFC animation) fills in a demo card number. Secondary: manual card-number entry. App loads the card from our API. Card is saved for next time.
- **F2b Mock Leap backend:** Google Sheet + Apps Script web API. Operations: get card (balance, type, last 5 transactions), top up (add amount, append transaction row). Seed with 3 demo cards.
- **F3 Top-up amount:** dial + tap-to-enter, as in the real app.
- **F4a Card payment (simulated):** "saved card" payment, as in the real app. Makes the clone work end-to-end before P1.
- **F7 Success:** amount, new balance (from our API), reference number, timestamp. No second card tap: our backend is the source of truth.
- **F7b Transactions:** last 5 transactions, from our API.
- **F11 Disclaimer label** on all screens.
- *If late, cut:* F7b.

### P1 — Google Pay / Apple Pay (hard stop 1:45)
- **F4b Payment method picker:** Google Pay, Apple Pay, saved card.
- **F5 Google Pay:** real Google Pay sheet, TEST environment, EUR, IE. On success, call our top-up API.
- **F6 Apple Pay (simulated):** Apple-style sheet, Face ID / double-click animation, then our top-up API.
- **F14 Live backend view:** Google Sheet open beside the app in the demo; balance cell updates after each top-up.
- *If late, cut:* F6, then F14.

### P2 — Live bus + fare (hard stop 2:30; built in parallel)
- **F8 Live map:** route selector (3 Dublin Bus routes at the event; since extended to every Dublin Bus and Go-Ahead Ireland route in Dublin, with up to 8 saved routes per user), route line, live bus markers, refresh every ~20 s.
- **F9 Stop list:** stops for the selected route; tap stop → next 3 arrivals, each tagged "Live" or "Scheduled".
- **F10 Data source toggle:** LIVE / RECORDED, with badge showing source and last-updated time.
- **F12 Fare + smart top-up:** stop detail shows the fare (demo value €2.00, configurable) vs. card balance. If balance is below the trigger (OQ3), show inline "Top up €10 with Google Pay". One tap. Balance updates. Map keeps running.
- **F13 Smooth bus movement:** animate markers between updates.
- *If late, cut:* F13, then F12, then LIVE mode (keep RECORDED).

### Code freeze 2:30–3:00
Regression test, record backup video, rehearse twice. Only P0 bug fixes.

### Out of scope (mention as "next steps" in demo)
Real Apple Pay (Merchant ID + domain verification), NFC read/write via NTA partnership, buy/collect tickets, capping values, email receipts, auto top-up, journey planner, push alerts, Irish language.

## 7. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR1 | Runs in Chrome desktop, DevTools device mode (iPhone 14 / Pixel 7 viewports). |
| NFR2 | No secrets in the browser bundle. NTA key and backend shared secret stay server-side. |
| NFR3 | No payment data stored or sent anywhere. |
| NFR4 | Live tab first render < 3 s on good Wi-Fi. RECORDED mode works with no API access. Mock backend call < 3 s (Apps Script latency ~1–2 s); app shows a loading state. |
| NFR5 | Zero cost: free tiers only (Vercel Hobby, OSM tiles, NTA free key, Google Pay TEST). |
| NFR6 | No console errors in the demo flow. |
| NFR7 | Tap targets ≥ 44 px. Text contrast ≥ 4.5:1. |

## 8. Success metrics (demo)

| Metric | Target |
|---|---|
| Taps from Home to top-up success (Google Pay) | ≤ 4 (current app: card entry + NFC steps; PO to count from screenshots) |
| Demo flow completion without error | 100% in 2 rehearsals |
| Live buses visible on map | ≥ 1 vehicle per route |
| Judge "wow" moment | Smart top-up shown in < 40 s |

## 9. Assumptions and constraints

- A1. Judges accept TEST-mode Google Pay and a simulated Apple Pay as valid proof of concept.
- A2. NTA GTFS-Realtime key may not arrive in time. RECORDED mode covers this.
- A3. Demo Chrome profile is signed in to a Google account (Google Pay sheet needs it).
- A4. Route IDs (e.g. 46A, 39A, 16) may have changed under BusConnects. Final 3 routes come from the current GTFS feed.
- C1. 3-hour build. 2 humans + Devin.
- C2. No official TFI logo files. Brand colour and text only.
- C3. Google Apps Script has quotas and ~1–2 s latency. Acceptable for a demo; not for production.

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| No NTA key | No live data | RECORDED mode |
| Venue Wi-Fi down | Map and Google Pay fail | Phone hotspot; RECORDED mode; backup video |
| Google Pay popup blocked | P0 demo step fails | Pre-test in demo profile; allow popups |
| Apps Script slow or down | Top-up appears stuck | Loading state; 8 s timeout; local fallback mode that updates balance in the browser and flags "offline" |
| Scope creep | Demo not ready | Hard stops per phase (section 6); code freeze at 2:30 |

## 11. Decisions log

| ID | Decision | Source |
|---|---|---|
| D1 | Clean-room rebuild from screenshots. | PO, Q1 |
| D2 | Own mock backend (Google Sheet + Apps Script). No TFI card systems. | PO |
| D3 | NFC scan is simulated. Reason: card keys belong to NTA; Web NFC cannot talk to MIFARE DESFire. | PO + Eng |
| D4 | No second card tap after payment. Our backend is the source of truth. | Eng proposal |
| D5 | Priority P0 clone → P1 Google Pay → P2 live bus + fare, with hard stops. Devin builds P2 in parallel. | PO |

## 12. Resolved questions (accepted by PO in v1.0)

1. **OQ2.** Top-up limits: min €5, max card balance €150. (Verify on leapcard.ie.)
2. **OQ3.** Smart top-up trigger: balance < €4.00 (2 × €2.00 fare).
3. **OQ4.** Demo card starting balance: €3.20 (triggers the wow moment).
4. **OQ5.** Payment method order in P1: Google Pay, Apple Pay, then saved card (from the P0 clone).
5. **OQ6.** Card identification: simulated scan as the main path; manual card-number entry as a secondary link.
