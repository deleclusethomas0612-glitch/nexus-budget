// Fonction serverless Vercel : renvoie le cours EUR (spot Coinbase) de plusieurs
// cryptos en un seul appel. Same-origin (/api/crypto?symbols=BTC,ADA), sans CORS
// ni clé. Réponse : { prices: { BTC: 55428.23, ADA: 0.167, ... } }.

const ALLOWED = new Set([
  'BTC', 'ADA', 'FET', 'ONDO', 'DOT', 'ICP', 'JASMY', 'ENJ', 'ATOM', 'IMX', 'GRT',
]);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const raw = String((req.query && req.query.symbols) || '').toUpperCase();
  const syms = [...new Set(
    raw.split(',').map(s => s.trim()).filter(s => /^[A-Z0-9]{2,10}$/.test(s) && ALLOWED.has(s))
  )];
  if (!syms.length) return res.status(400).json({ error: 'symbols requis' });

  const prices = {};
  await Promise.all(syms.map(async (sym) => {
    try {
      const r = await fetch(`https://api.coinbase.com/v2/prices/${sym}-EUR/spot`, {
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) return;
      const j = await r.json();
      const p = Number.parseFloat(j && j.data && j.data.amount);
      if (Number.isFinite(p)) prices[sym] = p;
    } catch {
      /* symbole ignoré si échec */
    }
  }));

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  return res.status(200).json({ prices });
}
