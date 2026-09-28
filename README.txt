WTI PRO v4.0 RESEARCH STARTER

This is a standalone replacement UI, not a patch to v3.0.
Upload the CONTENTS of this folder (including api folder) to a NEW GitHub branch.
Do not upload to main until the Vercel preview has been tested.

INCLUDED
- Mobile-friendly PWA and historical 5m/15m/1H charts
- RSI, MACD histogram, ATR, trend alignment
- Market-hours status (indicative NYMEX weekly schedule only)
- Unofficial Yahoo CL=F delayed/unverified historical data
- Best-effort Google News RSS headlines; provider may block or change
- Risk calculator

NOT INCLUDED / NOT VERIFIED
- Licensed live NYMEX feed or contract matching to TradingView CL1!
- Real-time news sentiment or reliable economic calendar
- Automated trade execution or live entry signals
- Background iPhone push notifications
- Production-grade backtesting, trade journal or licensed news API

TEST
1. Create new GitHub branch wti-pro-v4-test from main.
2. Upload the 8 root files and 3 API files, preserving the api/ folder.
3. Open Vercel preview URL; test /api/candles, /api/market-status and /api/news.
4. Confirm charts show DELAYED / UNVERIFIED and market hours are labeled indicative.
5. Only merge after preview passes. Keep v3.0 main intact meanwhile.

IMPORTANT: This is a new starter app. It does not retain all v3.0 features,
including the old historical backtest and in-app research alerts.
