# CLAUDE.md — nexus-budget

Guide de contexte pour Claude. À lire au début de chaque session sur ce projet.

## Vue d'ensemble

App **perso** de suivi de budget pour un **couple (2 personnes)**. Usage privé, pas destinée à être vendue ou distribuée. UI en français, mobile-first (téléphone). Design sombre « néon », navigation par onglets avec swipe horizontal.

5 onglets : `dashboard` (Cash Dispo + flux d'avances), `expenses` (Charges communes), `personal` (Mes Charges perso), `savings` (Épargne, dont PEA valorisé en direct), `history` (Journal des flux).

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
| `savingsAccounts` / `savings_accounts` | compte simple `{ id, name, balance }` **ou** portefeuille `{ id, name, isPortfolio:true, holdings:[{ fundId, shares, lastVL, vlAt }], cash }` |
| `savingsPending` / `savings_pending` | `{ id, label, amount, targetAccountId }` (avances sur épargne) |
| `personalExpenses` / `personal_expenses` | `{ id, label, amount, isPaid, comment }` |

Les `id` sont des `Date.now()`.

### Sauvegarde

- **Auto-save anti-rebond 800 ms** ([`useEffect`](src/App.jsx) → `saveData`) : toute modif de state déclenche un `upsert` de **toutes** les colonnes, 800 ms après la dernière modif (regroupe les frappes clavier).
- En cas d'échec → `saveError` affiche une **bannière rouge**. Ne pas réintroduire d'écritures par-colonne (`saveToCloud` a été supprimé au profit d'un chemin unique).

## Logique métier (⚠️ le cœur, à manipuler avec soin)

Tout est dans le `useMemo` `totals` de [`src/App.jsx`](src/App.jsx).

- **Provision mensuelle** = `round(totalAnnual / 12)`. **Toujours pleine**, quelle que soit la date de démarrage d'une provision. Alimente le « Total Mensuel » et le virement.
- **Virement / P** = `ceil((totalFixed − creche + provision) / 2)` = la **part d'une personne** des charges communes (couple → `/2`).
- **`creche`** = un item de `fixedExpenses` dont le nom contient « crèche ». **Soustrait avant le `/2`** car c'est une **charge perso** (payée par une seule personne, pas partagée). Elle vit désormais côté onglet perso ; le cas spécial reste au cas où elle réapparaîtrait dans les charges communes.
- **Cumul des provisions = CONTINU, sans reset au 1er janvier.** Ancre = **janvier 2026** en « mois absolus » (`année*12 + mois`, `ANCHOR = 2026*12`).
  - Sans date : `max(0, moisCible − ANCHOR)`.
  - Avec date : `max(0, moisCible − moisDémarrage + 1)` (**mois de démarrage inclus**).
  - Au passage d'année le solde **continue** (ne repart pas à zéro). Les régularisations annuelles (paiement d'une charge annuelle, petits écarts) se font **manuellement via Dépenses / Recettes**.
- **`realCash`** (Cash Dispo) = `round(accProvision(maintenant) + totalReimbursed − totalPaid − totalPending)`. `startCash = 0`.
- **Projection** = 12 barres Jan→Déc de l'année en cours.
- **Total épargne** = Σ valeur des comptes. **Portefeuille** = `round(Σ(parts × VL) + cash)`, arrondi à l'euro (pas de centimes ; les parts sont fractionnées).

### PEA / valorisation live (VL)

- Fonds du Plan d'Épargne BoursoBank, table `BOURSO_FUNDS` (portée module) :
  - Bourso Monde — code Boursorama `0P0001US9F`, ISIN `FR001400RWK6`.
  - Bourso US — code `0P0001US9I`, ISIN `FR001400RWL4`.
  - (6 autres fonds existent : Europe, France, Luxe, Santé, Tech, Climat — table extensible.)
- Ce sont des **fonds à VL quotidienne** (pas d'intraday temps réel).
- [`api/vl.js`](api/vl.js) : récupère la VL sur la page Boursorama `bourse/opcvm/cours/<code>/` côté serveur (same-origin `/api/vl?symbol=…`, **pas de CORS**, pas de clé). Parse la 1re occurrence de `data-ist-last` (format FR : espace = milliers, virgule = décimale).
- Client : `fetchVLs` appelle l'endpoint, remplit `vlMap`, et **met en cache** `lastVL` dans chaque ligne (reste lisible si la source échoue). Rafraîchi au chargement + bouton MAJ.

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

## Pièges connus

- Un seul fichier composant : les states mappent 1:1 aux colonnes DB. Ajouter une donnée = l'imbriquer dans un JSON existant, **pas** une nouvelle colonne.
- Les champs texte (Km essence, commentaire perso, parts) reposent sur l'auto-save anti-rebond.
- Fichiers hors périmètre app à ne pas relinter/committer : aucun (les vieux `App.jsx.bak/-test/_temp` ont été supprimés).
