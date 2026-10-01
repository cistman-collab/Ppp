// WTI Pro multi-source oil + maritime news monitor.
// Public RSS is best-effort and may be delayed or incomplete.

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  const queries = [
    'WTI crude oil when:1d',
    'OPEC oil when:1d',
    'EIA crude oil inventories when:2d',
    'Iran oil Strait of Hormuz when:2d'
  ];

  const maritimeQueries = [
    'Strait of Hormuz tanker shipping oil when:2d',
    'oil tanker Red Sea shipping disruption when:2d',
    'crude tanker attack shipping when:2d'
  ];

  const decode = s =>
    String(s || '')
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

  function parseRSS(xml, category) {
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .map(match => {
        const tag = name =>
          decode(
            (
              match[1].match(
                new RegExp(
                  '<' +
                    name +
                    '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' +
                    name +
                    '>'
                )
              ) || []
            )[1] || ''
          ).trim();

        return {
          title: tag('title'),
          link: tag('link'),
          published: tag('pubDate'),
          category
        };
      })
      .filter(
        x =>
          x.title &&
          /^https?:\/\//.test(x.link)
      );
  }

  async function fetchQuery(query, category) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);

    try {
      const url =
        'https://news.google.com/rss/search?q=' +
        encodeURIComponent(query) +
        '&hl=en-US&gl=US&ceid=US:en';

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/rss+xml, application/xml, text/xml'
        }
      });

      if (!response.ok) {
        throw Error('HTTP ' + response.status);
      }

      return parseRSS(
        await response.text(),
        category
      );
    } finally {
      clearTimeout(timer);
    }
  }

  function uniqueNewest(items, limit) {
    const seen = new Set();

    return items
      .filter(item => {
        const key = item.title.toLowerCase();

        if (seen.has(key)) return false;

        seen.add(key);
        return true;
      })
      .sort(
        (a, b) =>
          new Date(b.published || 0) -
          new Date(a.published || 0)
      )
      .slice(0, limit);
  }

  function maritimeRisk(items) {
    const text = items
      .map(x => x.title.toLowerCase())
      .join(' ');

    const highWords = [
      'attack',
      'closed',
      'closure',
      'blocked',
      'blockade',
      'seized',
      'missile',
      'explosion',
      'collision',
      'sunk'
    ];

    const elevatedWords = [
      'threat',
      'warning',
      'reroute',
      'rerouting',
      'delay',
      'disruption',
      'tension',
      'escort'
    ];

    if (highWords.some(x => text.includes(x))) {
      return 'HIGH';
    }

    if (elevatedWords.some(x => text.includes(x))) {
      return 'ELEVATED';
    }

    return 'NORMAL / UNCONFIRMED';
  }

  try {
    const oilResults = await Promise.allSettled(
      queries.map(q => fetchQuery(q, 'OIL'))
    );

    const maritimeResults = await Promise.allSettled(
      maritimeQueries.map(q =>
        fetchQuery(q, 'MARITIME')
      )
    );

    const oilItems = uniqueNewest(
      oilResults.flatMap(r =>
        r.status === 'fulfilled'
          ? r.value
          : []
      ),
      12
    );

    const maritimeItems = uniqueNewest(
      maritimeResults.flatMap(r =>
        r.status === 'fulfilled'
          ? r.value
          : []
      ),
      8
    );

    if (!oilItems.length && !maritimeItems.length) {
      throw Error('No current RSS headlines available');
    }

    return res.status(200).json({
      source: 'Google News RSS searches (best effort)',
      verifiedRealTime: false,
      fetchedAt: new Date().toISOString(),

      items: oilItems,

      maritime: {
        area: 'Hormuz / tanker / Red Sea',
        risk: maritimeRisk(maritimeItems),
        liveAIS: false,
        items: maritimeItems
      },

      disclaimer:
        'Oil and maritime headlines may be delayed or incomplete. Maritime risk is headline-based and is not live AIS vessel tracking.'
    });

  } catch (e) {
    return res.status(503).json({
      error: e.message,
      items: [],
      maritime: {
        risk: 'UNKNOWN',
        liveAIS: false,
        items: []
      }
    });
  }
};
