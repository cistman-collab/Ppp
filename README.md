# WTI Pro repair candidate

This is a testing candidate based on `wti-render-test` at `2527c12`.
Deployment and changes to production configuration require owner approval.

## Run and test

Use Node 22. Run `npm ci --ignore-scripts`, then `npm test`.
The tests use synthetic broker responses, temporary local data and mocked push delivery.
No real IG or OpenAI credentials are needed. HTTP integration tests run on Linux CI;
the Windows desktop sandbox cannot route localhost requests.

For the synthetic local preview, run `node tests/preview.mjs`.
The preview removes credential variables, disables background monitoring and uses
`test-data/preview`, never an existing Render disk or push subscription.

## Behavior

- PREPARE means the timeframe setup is present, but the completed 5m trigger is missing.
- ENTER means a completed trigger confirms a valid LONG/SHORT price plan. No trade is executed.
- WAIT blocks both stages when the feed, contract, freshness, broker market status,
  price delay, timeframe alignment or configured event protection is invalid.
- The journal tracks simulated midpoint fills after a signal, not the owner's broker positions.
- Rollover preserves old records and ends unresolved old-contract simulations as
  ROLLED_OVER, with their prior status retained. They are excluded from learning.
- Price history removed from the active 4,000-candle window is archived on disk.
- Performance memory is descriptive, cost-adjusted simulated net R. Fewer than
  20 evaluated outcomes means insufficient data. It never changes strategy automatically.

## Protect existing configuration

Keep the existing `WTI_DATA_DIR`, IG credentials, VAPID keys and subscription file.
Do not regenerate VAPID keys or copy production data into a test service.
Set `WTI_MONITOR_ENABLED=false` in every test service. The live service keeps its
existing default monitor behavior unless explicitly disabled.

`WTI_ACCESS_TOKEN` optionally enables a private single-owner sign-in and protects
the screen and APIs with an expiring HttpOnly cookie. Set it in Render, never Git.
Changing this variable or enabling it is part of the approval-gated deployment plan.
An existing push subscription is preserved if another device or key attempts to replace it.

## Required before deployment approval

1. Back up the entire existing persistent disk and verify a restore to a separate disk.
2. Review passing CI and inspect the repaired app in an iPhone-sized browser.
3. Compare displayed prices and contract expiry with the owner's IG platform;
   the default `IG_PRICE_DIVISOR=100` deliberately preserves existing conversion.
4. Verify test-service data isolation, private access and background-monitor configuration.
5. Check notification permission, receipt with the app closed, tap navigation,
   PREPARE/ENTER and outcome delivery on an actual iPhone Home Screen installation.
6. Confirm journal counts and data continuity against a read-only copy of existing data.
7. Approve a specific commit and rollout. Do not merge or deploy before approval.

The static event calendar, best-effort RSS news and technical-only backtest remain
limited research inputs. Backtest development outcomes stop before validation starts;
news/event risk is not replayed, overlapping simulations are not a portfolio return,
and simulated statistics must not be presented as proven profitability.

## Approved isolated iPhone preview

The separate free service starts with `node tests/preview.mjs`, never `npm start`.
It removes IG/OpenAI/monitor credentials, forces a separate ephemeral test directory,
creates its own test VAPID keys, disables background monitoring, refreshes synthetic
history and labels the page and Home Screen installation as a test preview.
Scenario buttons demonstrate PREPARE/ENTER in both directions; they are screen fixtures,
not signals. Test Alert schedules a labeled synthetic notification after 10 seconds.
No original service, environment group or persistent disk should be cloned or attached.
Test data and notification registration can reset on free-service replacement; enable
alerts again only in the preview if needed. The existing app's subscription is untouched.
`render-preview.yaml` records the equivalent configuration; direct service creation
uses the same free plan, branch and commands with automatic deploys disabled.

## Automatic bot plan
Signals opens with an automatically calculated plan from the read-only server monitor. No account or manually chosen prices are required. PREPARE shows provisional levels and the exact completed-candle trigger; ENTER requires the monitor's confirmed entry. Invalid, closed, delayed, blocked or stale contexts clear all actionable prices. The card calculates conservative gross risk/reward from the worst entry in the zone and the stop, separately for each target. Costs and Trading 212 contract equivalence are not assumed.
AI reviews each distinct confirmed setup/candle once while the page is open when configured. It never changes the deterministic signal or invents levels. Changed or stale setups discard late AI replies; a 10-second watchdog expires the plan even without a successful refresh. Historical memory remains descriptive simulation, not automatic retraining. This feature does not place trades or size an account without verified account and broker information.

## Inventory and combined decision view
The bot card includes news direction, maritime/event risk, official EIA inventories and AI Review together; detailed technical checks and historical evidence can be expanded underneath. `/api/inventories` reads EIA's public WPSR `https://ir.eia.gov/wpsr/psw00.json` without an API key. Only the exact WCESTUS1 US commercial crude series excluding SPR is accepted, in thousand barrels, with valid consecutive weekly observations and a valid release date. Stocks and weekly changes display in million barrels. No global coverage, Cushing series or analyst consensus feed is implied.

The server caches successful requests for 30 minutes and failed requests for 5 minutes, sharing concurrent fetches. Reports older than 10 days or observations older than 16 days are marked stale. Suppressed/missing figures, unexpected units/series, bad dates and network failures never become inventory confirmation. Synthetic preview disables the live inventory feed. No existing journal, push registration or credentials are changed; the cache is in memory.

The same verified inventory context is passed through the monitor to AI Review, ignoring browser-supplied inventory figures. Weekly builds/draws are background context, not live entry/exit triggers, and no forecast surprise is invented. Entry rules, stop/target geometry and risk gates remain deterministic. Proposed exit levels are not a connected broker position. Historical backtests do not replay these inventory releases, so their results must not be represented as validation of an inventory-driven strategy.

## Broker-style chart display
The chart defaults to 4H and retains explicit IG contract/expiry/status labels. Price is the selected timeframe's completed candle midpoint, with its UTC close timestamp; it is not an executable Trading212 CFD buy/sell quote. Home separately labels the latest completed5m close. The owner chose labelled IG data after Trading212 confirmed its public API is limited to Invest/ISA accounts. No broker price is hardcoded or translated and no contract is switched.

Display overlays: EMA9/21, SMA50/200, Bollinger20 with two population standard deviations, and the existing daily pivot/R1/R2/S1/S2 references. Lower panels show Stochastic14,3,3 and Wilder RSI14 with SMA14 smoothing. Calculations use all available aggregated completed candles before selecting the last80 displayed samples. Missing warmup is omitted, not backfilled; flat oscillators are neutral50. Limited4000-bar5m storage may prevent a200-period average on4H. No exchange-volume profile is fabricated. These are explicit display settings, not a claim to reproduce unknown settings in the owner's screenshot. Entry logic, alerts, journal and AI source data are unchanged; the visual MACD panel is replaced by Stochastic while signal MACD calculations remain.
