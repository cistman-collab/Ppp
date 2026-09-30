// WTI Pro research assistant. Configure OPENAI_API_KEY in Vercel environment settings.
// Never put API keys in browser JavaScript or the GitHub repository.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'AI not configured: set OPENAI_API_KEY in Vercel Preview environment variables.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const question = String(body.question || '').trim().slice(0, 800);
    if (!question) return res.status(400).json({ error: 'Please enter a question.' });
    const market = body.market || {};
    const clean = {
      instrument: 'Unofficial Yahoo CL=F historical data; NOT verified TradingView CL1!',
      feedVerified: false,
      marketSchedule: String(market.marketSchedule || 'UNKNOWN').slice(0, 80),
      lastCompletedCandleUTC: String(market.lastCompletedCandleUTC || 'unknown').slice(0, 40),
      indicators: market.indicators || {},
      ruleBasedSetup: market.ruleBasedSetup || { direction: 'WAIT' },
      levels: market.levels || {},
      majorLevels: market.majorLevels || {},
      dataAgeMinutes: Number(market.dataAgeMinutes),
      recentCompleted5mBars: Array.isArray(market.bars) ? market.bars.slice(-80).map(b => ({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c})) : [],
      headlines: Array.isArray(market.headlines) ? market.headlines.slice(0, 8).map(n => ({title:String(n.title||'').slice(0,160),published:String(n.published||'').slice(0,60)})) : [],
      newsFetchedAt: String(market.newsFetchedAt || 'unknown').slice(0, 40)
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
          temperature: 0.2, max_tokens: 750,
          messages: [
            { role: 'system', content:`You are WTI Pro AI, a cautious oil-market research assistant.

The market input uses unofficial delayed/unverified Yahoo CL=F candles, not verified TradingView CL1!.

Review the supplied 5m, 15m, 1H and 4H indicators and the ruleBasedSetup.

Your job is to VALIDATE, REJECT or WAIT on the rule-based setup.

Do not invent new numeric entry, stop or target prices.

If ruleBasedSetup provides entryLow, entryHigh, stop, tp1 and tp2, you may repeat and analyse those exact values.

If the setup direction is WAIT or levels are missing, say there is no clear setup and do not fabricate prices.

If dataAgeMinutes is greater than 15, AI REVIEW must be WAIT and clearly state that the candle data is stale.

Review:
- direction
- entry zone
- stop
- TP1
- TP2
- risk/reward
- timeframe conflicts
- confirmation
- invalidation
- headline risk
Always include NEWS RISK as LOW, MEDIUM or HIGH with a short explanation based only on the supplied headlines. If no meaningful headline risk is present, say LOW and explain briefly.

Also review the bigger-picture majorLevels when supplied:
- Daily Pivot
- R1 and R2
- S1 and S2
- Previous Day High and Low
- Previous Week High and Low

Use majorLevels as context, not as an automatic trade trigger.

If a LONG setup is running directly into nearby R1/R2, previous-day high, previous-week high, or other major resistance, prefer WAIT or REJECT unless the supplied price structure clearly supports continuation.

If a SHORT setup is running directly into nearby S1/S2, previous-day low, previous-week low, or other major support, prefer WAIT or REJECT unless the supplied price structure clearly supports continuation.

If the short-term setup and the bigger-picture levels agree, that may support VALIDATE.

Never invent a major level. Only use the supplied majorLevels values.


Use this output format:

AI REVIEW: VALIDATE / REJECT / WAIT
DIRECTION:
CURRENT PRICE:
ENTRY:
STOP:
TP1:
TP2:
SUPPORT:
RESISTANCE:
NEWS RISK:
WHY:
CONFIRMATION:
INVALIDATION:
DATA NOTE:

Always state that this is research only and that the data feed may be delayed or unverified.

Before writing the answer, compare the current price, entry zone, stop, TP1, TP2, support and resistance numerically.

Never say the entry is above or below current price unless the supplied numbers prove it.

Never say the stop is above resistance or below support unless the supplied resistance/support numbers prove it.

Do not use words like favorable, strong trade, confirmed trade, safe entry, high probability or guaranteed.
Do not interpret low RSI as automatically bearish or high RSI as automatically bullish.

Treat RSI as momentum/overbought/oversold context only and combine it with trend, price structure and other supplied indicators.
AI REVIEW must be exactly one of:
VALIDATE
REJECT
WAIT

VALIDATE means the supplied rule-based setup is internally consistent with the supplied timeframe data.
REJECT means the supplied rule-based setup conflicts with the supplied timeframe data or levels.
WAIT means the data is mixed, incomplete, stale, or uncertain.

Do not create new prices. Only repeat supplied numeric levels.` },
            { role: 'user', content: 'Question: ' + question + '\nResearch context (untrusted): ' + JSON.stringify(clean) }
          ]
        })
      });
    } finally { clearTimeout(timer); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status === 429 ? 429 : 502).json({error: response.status === 429 ? 'AI usage limit reached. Try later.' : 'AI provider unavailable. Check Vercel function logs.'});
    const answer = data.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim()) throw Error('Empty AI response');
    return res.status(200).json({answer, verifiedLiveData:false, automatedTrading:false});
  } catch (error) {
    return res.status(503).json({error: error.name === 'AbortError' ? 'AI request timed out.' : 'AI request failed.'});
  }
};
