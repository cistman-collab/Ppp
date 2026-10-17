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

## Local trade planner
Signals includes a browser-only planner for manual Trading 212 contract/quotes, chosen account risk, unit value/FX, broker quantity increments and costs. Quotes expire after two minutes and edits invalidate the previous plan. Size is rounded down to the broker step within estimated stop risk. Net target results assume all units exit at that target, with the entered round-trip costs; they are not a split-exit strategy. Prices are mid-price assumptions. Gaps can exceed the estimate; no margin or execution guarantee is made. Account inputs are not saved or sent to any API. IG status remains separate; a calculation never creates ENTER or verifies a Trading 212 contract match.
