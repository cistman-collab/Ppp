WTI Pro Mobile v0.3

Deploy this folder to an HTTPS static host. On iPhone open the hosted URL in Safari > Share > Add to Home Screen. Offline shell is cached, but market data cannot refresh offline.

Optional feed endpoint must allow CORS from your hosted app and return JSON:
{ "symbol":"CL1!", "exchange":"NYMEX", "source":"YOUR LICENSED FEED", "delayed":false, "bars":[{"t":"2026-09-25T14:00:00Z","o":92.1,"h":92.3,"l":92.0,"c":92.2,"v":100}, ...] }
Bars must be consecutive 5m candles (at least 15), timestamped by candle OPEN in UTC, most recent closed candle no more than 12 minutes old. The backend must authenticate to the licensed feed; NEVER expose API keys to the browser. CL1! contract rollover logic belongs on backend.

This version does not include a market-data provider, a server, background push notifications or automatic trade execution. No simulated candles are real trading signals.
