# CLAUDE.md — nexus-budget

Guide de contexte pour Claude. À lire au début de chaque session sur ce projet.

## Vue d'ensemble

App **perso** de suivi de budget pour un **couple (2 personnes)**. Usage privé, pas destinée à être vendue ou distribuée. UI en français, mobile-first (téléphone). Design sombre « néon », navigation par onglets avec swipe horizontal.

6 onglets : `dashboard` (Cash Dispo + flux d'avances), `expenses` (Charges communes), `personal` (Mes Charges perso — **pointage seul, hors calculs**), `savings` (Épargne, dont PEA valorisé en direct), `crypto` (Portefeuille crypto valorisé via Coinbase), `history` (Journal des flux).

## Stack

- **React 19** + **Vite 7**, un seul gros composant : [`src/App.jsx`](src/App.jsx) (~900 lignes).
- **Tailwind v4** (classes utilitaires inline), **framer-motion** (drag & reorder), **recharts** (graphe projection), **lucide-react** (icônes).
- **Supabase** : auth (email/mot de passe) + stockage. Client dans [`src/supabase.js`](src/supabase.js).
- **Fonction serverless Vercel** : [`api/vl.js`](api/vl.js).
- Déployé sur **Vercel** (auto-deploy au push sur `main`).

## Architecture des données

Une seule table Supabase `nexus_data`, une ligne par utilisateur (`user_id`). Chaque **state React = une colonne JSON**. Il n'y a pas d'accès migration/DDL depuis ici → **ne pas ajouter de colonne** ; ranger toute nouvelle donnée dans les tableaux/JSON existants (ex. champs imbriqués dans un item).

| State / colonne | Forme des items |
|---|---|
| `fixedExpenses` / `fixed_expenses` | `{ id, name, amount }` (charges communes mensuelles) |
| `annualExpenses` / `annual_expenses` | `{ id, name, amount, startDate\|null }` (provisions annuelles) |
| `pending` / `pending` | `{ id, label, amount }` (avances en cours, onglet dashboard) |
| `reimbursements` / `reimbursements` | `{ id, label, amount }` (recettes) |
| `exceptionalPaid` / `exceptional_paid` | `{ id, label, amount }` (dépenses exceptionnelles) |
| `history` / `history` | `{ id, label, amount, type: 'payment'\|'reimb'\|…, date, isArchived? }` |
| `savingsAccounts` / `savings_accounts` | compte simple `{ id, name, balance }`, portefeuille `{ id, name, isPortfolio:true, holdings:[{ fundId, shares, lastVL, vlAt }], cash }`, **ou crypto** `{ id, kind:'crypto', sym, qty, lastPrice, priceAt }` (affiché sur la page Crypto, **exclu** de la page/total Épargne via `kind !== 'crypto'`) |
| `savingsPending` / `savings_pending` | `{ id, label, amount, targetAccountId }` (avances sur épargne) |
| `personalExpenses` / `personal_expenses` | `{ id, label, amount, isPaid, comment }` (pointage mensuel ; **n'entre dans aucun calcul**) |

Les `id` sont des `Date.now()`.

### Sauvegarde

- **Auto-save anti-rebond 800 ms** ([`useEffect`](src/App.jsx) → `saveData`) : toute modif de state déclenche un `upsert` de **toutes** les colonnes, 800 ms après la dernière modif (regroupe les frappes clavier).
- En cas d'échec → `saveError` affiche une **bannière rouge**. Ne pas réintroduire d'écritures par-colonne (`saveToCloud` a été supprimé au profit d'un chemin unique).

## Logique métier (⚠️ le cœur, à manipuler avec soin)

Tout est dans le `useMemo` `totals` de [`src/App.jsx`](src/App.jsx).

- **Provision mensuelle** = `round(totalAnnual / 12)`. **Toujours pleine**, quelle que soit la date de démarrage d'une provision. Alimente le « Total Mensuel » et le virement.
- **Charges communes** = tout ce que le foyer paie **à deux** (on y met ce qu'on veut). Aucune exception ni catégorie spéciale : c'est juste partagé par 2.
- **Charges perso** = **pointage uniquement**. `personalExpenses` sert à cocher « payé ce mois-ci » et à suivre (Km, virement wifi…). N'entre dans **aucun** calcul (ni `realCash`, ni virement, ni projection, ni épargne). Seul `personalTotal` est affiché, sur son onglet.
- **Virement / P** = `ceil((totalFixed + provision) / 2)` = la **part d'une personne** des charges communes (couple → `/2`). Aucune catégorie spéciale : tout ce qui est dans les charges communes est partagé par 2. (L'ancien terme `− creche` a été retiré.)
- **Cumul des provisions = CONTINU, sans reset au 1er janvier.** Ancre = **janvier 2026** en « mois absolus » (`année*12 + mois`, `ANCHOR = 2026*12`).
  - Sans date : `max(0, moisCible − ANCHOR)`.
  - Avec date : `max(0, moisCible − moisDémarrage + 1)` (**mois de démarrage inclus**).
  - Au passage d'année le solde **continue** (ne repart pas à zéro). Les régularisations annuelles (paiement d'une charge annuelle, petits écarts) se font **manuellement via Dépenses / Recettes**.
- **`realCash`** (Cash Dispo) = `round(accProvision(maintenant) + totalReimbursed − totalPaid − totalPending)`. `startCash = 0`.
- **Projection** = 12 barres Jan→Déc de l'année en cours.
- **Total épargne** = Σ valeur des comptes. **Portefeuille** = `round(Σ(parts × VL) + cash)`, arrondi à l'euro (pas de centimes ; les parts sont fractionnées).

### PEA / valorisation live (VL)

- **Seuls le PEA et un compte-titres peuvent détenir des parts** (`canHoldTitles` : `isPortfolio` déjà actif ou nom contenant « pea »/« titre », insensible à la casse). Les autres comptes épargne sont **monétaires** (argent qui dort, saisi ~1×/an) : leur crayon ouvre un modal **Renommer** (`rename_savings`, change uniquement l'intitulé), jamais le portefeuille. L'assurance-vie est gérée à part, sans détail.
- Supports détenables, table `BOURSO_FUNDS` (portée module) :
  - Bourso Monde — code Boursorama `0P0001US9F`, ISIN `FR001400RWK6` (fonds).
  - Bourso US — code `0P0001US9I`, ISIN `FR001400RWL4` (fonds).
  - Amundi PEA Global ACWI — code `1rTGPEA`, ISIN `FR0014017NX3`, ticker `GPEA` (**tracker/ETF** coté Euronext Paris ; champ `ticker` → badge « ETF · GPEA » dans le modal).
  - (6 autres fonds Bourso existent : Europe, France, Luxe, Santé, Tech, Climat — table extensible.)
- Les fonds Bourso sont à **VL quotidienne** (pas d'intraday) ; l'ETF a un **cours coté** (dernier cours de la séance).
- [`api/vl.js`](api/vl.js) : récupère la valeur sur la page Boursorama côté serveur (same-origin `/api/vl?symbol=…`, **pas de CORS**, pas de clé). Deux chemins selon le support : `bourse/opcvm/cours/<code>/` (codes `0P…`) ou `bourse/trackers/cours/<code>/` (codes `1r…`) — le handler tente le plus probable puis l'autre en repli. Parse la 1re occurrence de `data-ist-last` (format FR : espace = milliers, virgule = décimale).
- Client : `fetchVLs` appelle l'endpoint, remplit `vlMap`, et **met en cache** `lastVL` dans chaque ligne (reste lisible si la source échoue). Rafraîchi au chargement + bouton MAJ.

### Crypto (page dédiée)

- Suivi de cryptos par **volume détenu**, valorisées au **cours Coinbase EUR**. Même patron que le PEA. Valeur = `round(qty × cours)` (arrondi à l'euro). Total « Portefeuille Crypto » = Σ, **page autonome** (n'impacte pas le Cash Dispo ni l'Épargne).
- Stockées dans `savings_accounts` avec `kind:'crypto'` → filtrées hors Épargne (`savingsView` / `cryptoAssets`). Registre `CRYPTOS` (portée module) : nom → ticker Coinbase. **ASI = ticker `FET`** sur Coinbase (`ASI-EUR` n'existe pas). 11 cryptos suivies (BTC, ADA, FET, ONDO, DOT, ICP, JASMY, ENJ, ATOM, IMX, GRT).
- [`api/crypto.js`](api/crypto.js) : `?symbols=BTC,ADA,…` → interroge `api.coinbase.com/v2/prices/<SYM>-EUR/spot` côté serveur (un seul appel groupé). Liste blanche `ALLOWED` = les 11 tickers. Client : `fetchCryptoPrices` remplit `cryptoPrices`, cache `lastPrice` dans chaque ligne. Rafraîchi au chargement + bouton MAJ.

## Commandes

```bash
npm run dev      # dev local (Vite). NB: /api/vl n'existe QUE sur Vercel, pas en local.
npm run build    # build prod (vite build)
npm run lint     # eslint . (le dossier api/ est ignoré)
```

## Déploiement & sécurité

- **Vercel** reconstruit et déploie à chaque `git push` sur `main`. Les fichiers `api/*.js` sont détectés comme fonctions serverless (projet Vite standard, pas de `vercel.json` nécessaire).
- **RLS activé** sur `nexus_data` (lecture anonyme bloquée — vérifié). La clé `VITE_SUPABASE_KEY` est une clé **publishable** (publique par nature, incluse dans le bundle). `.env` est **gitignoré** (`.env.example` documente les variables).

## Conventions & préférences de travail

- **Éditer un item = en place** : conserver `id` et position dans la liste (le crayon ne supprime PAS l'item ; `modal.data` porte l'item édité). Pour le perso, conserver aussi `isPaid` et `comment`.
- **build + lint AVANT chaque commit** ; garder **ESLint à zéro**.
- **Commit + push sur `main` après validation** de la tâche par l'utilisateur. Messages de commit en français, terminés par la ligne `Co-Authored-By: Claude …`.
- **Ne jamais altérer un solde / chiffre / calcul existant sans prévenir explicitement** l'utilisateur d'abord.
- UI, commits et échanges en français (convention observée).

## Effet néon (design)

`neon-pulse` (dans [`src/index.css`](src/index.css)) = liseré lumineux qui tourne lentement (conic-gradient floutée, 7 s) + halo ambiant coloré + liseré de verre. Variantes de couleur via classe additionnelle : `neon-pulse-cyan` (Épargne), `neon-pulse-green` (pointage payé), `neon-pulse-orange` (Crypto), `neon-pulse-pink` (Charges communes), `neon-pulse-ruby` (Perso), `neon-pulse-platinum` (Journal) ; défaut = **émeraude → menthe** (thème « Émeraude » choisi en août 2026, tout l'ancien violet/indigo a été remplacé).

**Code couleur par page** (validé août 2026) : Dashboard = émeraude · Charges communes = **rose** (section Mensuel Fixe) + **or/ambre** (section Provisions Annuelles, avec équivalent `/mois` affiché) · Perso = **rubis** (check « payé » reste vert néon) · Épargne = cyan · Crypto = orange · Journal = **platine** (flux : rouge = paiement, émeraude = recette, teal = autre). La nav reflète la couleur de chaque page sur l'onglet actif. L'ambre reste aussi la couleur des Avances (partout). Couleurs pilotées par les vars `--neon-1/2/-glow`. Respecte `prefers-reduced-motion` (rotation figée). Pour un nouvel univers de couleur, ajouter une variante `.neon-pulse-xxx` plutôt que de bricoler inline.

## Pièges connus

- Un seul fichier composant : les states mappent 1:1 aux colonnes DB. Ajouter une donnée = l'imbriquer dans un JSON existant, **pas** une nouvelle colonne.
- Les champs texte (Km essence, commentaire perso, parts) reposent sur l'auto-save anti-rebond.
- Fichiers hors périmètre app à ne pas relinter/committer : aucun (les vieux `App.jsx.bak/-test/_temp` ont été supprimés).
