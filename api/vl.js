// Fonction serverless Vercel : récupère la dernière valeur liquidative (VL) d'un
// fonds OPCVM depuis sa page Boursorama. L'app l'appelle en same-origin (/api/vl),
// ce qui évite tout blocage CORS côté navigateur. Aucune clé requise.

const KNOWN_SYMBOLS = {
  '0P0001US9F': 'Bourso Monde',
  '0P0001US9I': 'Bourso US',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const symbol = String((req.query && req.query.symbol) || '').trim();
  if (!/^[A-Za-z0-9]{4,20}$/.test(symbol)) {
    return res.status(400).json({ error: 'symbole invalide' });
  }

  try {
    const url = `https://www.boursorama.com/bourse/opcvm/cours/${symbol}/`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    });
    if (!r.ok) return res.status(502).json({ error: 'source indisponible', status: r.status });

    const html = await r.text();
    // 1re occurrence de la classe "dernier cours" = la VL du fonds de la page.
    const m = html.match(/c-instrument--last"[^>]*data-ist-last[^>]*>([\d\s .,]+)</);
    if (!m) return res.status(404).json({ error: 'VL introuvable' });

    // Format français : espace = milliers, virgule = décimale.
    const raw = m[1].replace(/[\s ]/g, '').replace(',', '.');
    const vl = Number.parseFloat(raw);
    if (!Number.isFinite(vl)) return res.status(404).json({ error: 'VL illisible' });

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    return res.status(200).json({ symbol, name: KNOWN_SYMBOLS[symbol] || null, vl });
  } catch {
    return res.status(502).json({ error: 'échec de récupération' });
  }
}
