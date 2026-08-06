// Fonction serverless Vercel : récupère la dernière valeur liquidative (VL) d'un
// fonds OPCVM ou le dernier cours d'un tracker/ETF depuis sa page Boursorama.
// L'app l'appelle en same-origin (/api/vl), ce qui évite tout blocage CORS côté
// navigateur. Aucune clé requise.

const KNOWN_SYMBOLS = {
  '0P0001US9F': 'Bourso Monde',
  '0P0001US9I': 'Bourso US',
  '1rTGPEA': 'Amundi PEA Global ACWI',
};

// Boursorama sert les OPCVM et les trackers sur deux chemins différents. Les codes
// d'OPCVM commencent par « 0P », ceux des trackers Euronext par « 1r ». On tente
// d'abord le chemin le plus probable, puis l'autre en repli.
const sectionsFor = (symbol) => (/^0P/i.test(symbol) ? ['opcvm', 'trackers'] : ['trackers', 'opcvm']);

// 1re occurrence de la classe « dernier cours » = la valeur de l'instrument de la page.
const parseLast = (html) => {
  const m = html.match(/c-instrument--last"[^>]*data-ist-last[^>]*>([\d\s .,]+)</);
  if (!m) return null;
  // Format français : espace (y compris insécable) = milliers, virgule = décimale.
  const v = Number.parseFloat(m[1].replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const symbol = String((req.query && req.query.symbol) || '').trim();
  if (!/^[A-Za-z0-9]{4,20}$/.test(symbol)) {
    return res.status(400).json({ error: 'symbole invalide' });
  }

  try {
    for (const section of sectionsFor(symbol)) {
      const r = await fetch(`https://www.boursorama.com/bourse/${section}/cours/${symbol}/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept-Language': 'fr-FR,fr;q=0.9',
        },
      });
      if (!r.ok) continue;

      const vl = parseLast(await r.text());
      if (vl == null) continue;

      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
      return res.status(200).json({ symbol, name: KNOWN_SYMBOLS[symbol] || null, vl });
    }
    return res.status(404).json({ error: 'VL introuvable' });
  } catch {
    return res.status(502).json({ error: 'échec de récupération' });
  }
}
