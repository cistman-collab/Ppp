// Contextual headlines only; public RSS may be delayed or unavailable.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    let response;
    try {
      response = await fetch('https://news.google.com/rss/search?q=WTI%20crude%20oil%20OPEC%20EIA&hl=en-US&gl=US&ceid=US:en', {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml, application/xml, text/xml' }
      });
    } finally { clearTimeout(timer); }
    if (!response.ok) throw Error('News provider HTTP ' + response.status);
    const xml = await response.text();
    const decode = s => s.replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map(match => {
      const tag = name => decode((match[1].match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>')) || [])[1] || '').trim();
      return { title: tag('title'), link: tag('link'), published: tag('pubDate') };
    }).filter(item => item.title && /^https?:\/\//.test(item.link));
    if (!items.length) throw Error('No parseable RSS headlines');
    return res.status(200).json({ source: 'Google News RSS search (best effort)', verifiedRealTime: false, items, disclaimer: 'Headlines may be delayed or incomplete. Read original reporting before acting.' });
  } catch (e) { return res.status(503).json({ error: e.message, items: [] }); }
};
