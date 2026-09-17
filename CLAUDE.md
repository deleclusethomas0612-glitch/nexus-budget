# CLAUDE.md — nexus-budget

Guide de contexte pour Claude. À lire au début de chaque session sur ce projet.

## Vue d'ensemble

App **perso** de suivi de budget pour un **couple (2 personnes)**. Usage privé, pas destinée à être vendue ou distribuée. UI en français, mobile-first (téléphone). Design sombre « néon », navigation par onglets avec swipe horizontal.

7 onglets : `dashboard` (Cash Dispo + flux d'avances), `expenses` (Charges communes), `personal` (Mes Charges perso — **pointage seul, hors calculs**), `savings` (Épargne, dont PEA valorisé en direct), `crypto` (Portefeuille crypto valorisé via Coinbase), `realestate` (Immobilier : actif net = valeur du bien − capital restant dû), `history` (Journal des flux).

## Stack

- **React 19** + **Vite 7**, un seul gros composant : [`src/App.jsx`](src/App.jsx) (~1900 lignes). Seule exception : [`src/realestate.js`](src/realestate.js), fonctions pures (sans React) du tableau d'amortissement, vérifiables par script node.
- **Tailwind v4** (classes utilitaires inline), **framer-motion** (drag & reorder), **recharts** (graphe projection), **lucide-react** (icônes).
- **Supabase** : auth (email/mot de passe) + stockage. Client dans [`src/supabase.js`](src/supabase.js).
- **Fonction serverless Vercel** : [`api/vl.js`](api/vl.js).
- Déployé sur **Vercel** (auto-deploy au push sur `main`).

## Architecture des données

Une seule table Supabase `nexus_data`, une ligne par utilisateur (`user_id`). Chaque **state React = une colonne JSON**. Il n'y a pas d'accès migration/DDL depuis ici → **ne pas ajouter de colonne** ; ranger toute nouvelle donnée dans les tableaux/JSON existants (ex. champs imbriqués dans un item).

| State / colonne | Forme des items |
|---|---|
| `fixedExpenses` / `fixed_expenses` | `{ id, name, amount }` (charges communes mensuelles) |
| `annualExpenses` / `annual_expenses` | `{ id, name, amount, startDate\|null, dueSchedule: [{ id, date, amount }], noProvision? }` (provisions annuelles ; `dueSchedule` = échéances armées et `noProvision:true` = **dépense programmée** du dashboard, cf. ci-dessous. Ancien format scalaire `dueDate`/`dueAmount` encore relu par `dueList`) |
| `pending` / `pending` | `{ id, label, amount }` (avances en cours, onglet dashboard) |
| `reimbursements` / `reimbursements` | `{ id, label, amount, paidOn }` (recettes ; `paidOn` = jour ISO, cf. datation des flux) |
| `exceptionalPaid` / `exceptional_paid` | `{ id, label, amount, paidOn }` (dépenses exceptionnelles ; `paidOn` = jour ISO, cf. datation des flux) |
| `history` / `history` | `{ id, label, amount, type: 'payment'\|'reimb'\|…, date, isArchived? }` |
| `savingsAccounts` / `savings_accounts` | compte simple `{ id, name, balance }`, portefeuille `{ id, name, isPortfolio:true, holdings:[{ fundId, shares, lastVL, vlAt }], cash }`, **crypto** `{ id, kind:'crypto', sym, qty, lastPrice, priceAt }` (page Crypto), **ou bien immobilier** `{ id, kind:'realestate', name, value, apport, releaseFees, loan:{ principal, rate, payment, insurance, deferred, months, firstDue, iraFreeAfter } }` (page Immobilier, un seul). Crypto et immobilier sont **exclus** de la page/total Épargne et du sélecteur *Compte Cible* via `isMoneyAccount` ; `reorderSavings` réinjecte le bien immobilier après un réordonnancement |
| `savingsPending` / `savings_pending` | `{ id, label, amount, targetAccountId }` (avances sur épargne ; `targetAccountId` ne peut viser qu'un compte « argent » — le sélecteur *Compte Cible* filtre via `isMoneyAccount`) |
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

### Échéances datées sur les provisions annuelles

Une provision annuelle peut porter une ou **plusieurs échéances armées** (paiement en plusieurs fois : impôts en 4 fois, etc.), stockées dans `dueSchedule: [{ id, date, amount }]` — chaque ligne a **sa date et son montant**, qui peuvent varier d'une échéance à l'autre et différer du prévisionnel `amount`. Saisie via l'icône `CalendarClock` de la bulle → modal `due_date` : liste de lignes date + montant, bouton **« Ajouter une échéance »**, croix pour retirer une ligne, total + écart vs prévisionnel affichés. Brouillon dans le state `dueDraft` (comme `portfolioDraft`), enregistré par `handleDueSave` (lignes incomplètes ignorées, tri chronologique automatique).

- **`dueList(e)`** (portée module) normalise les échéances en liste et assure la **rétrocompatibilité** : les provisions armées avant le multi-échéances portent encore `dueDate`/`dueAmount` scalaires, relus comme une liste à une ligne. Toujours passer par `dueList` / `dueTotal`, jamais lire `dueDate` directement.
- **Au jour J** : un `useEffect` (même garde `loading || !session` que l'auto-save) balaie les échéances de chaque provision ; celles dont la date est atteinte créent une **dépense** dans `exceptionalPaid` + une ligne `payment` dans `history` (datée du prélèvement, libellé numéroté `(n/total)` s'il y en a plusieurs), puis sont **retirées de `dueSchedule`** — les échéances suivantes restent armées. La provision reste en place et continue de cumuler ; elle se réarme manuellement l'année suivante. Le retrait rend l'opération **non rejouable** (pas de double débit).
- **Avant le jour J** : les échéances ne touchent **ni `realCash` ni le virement** — l'argent n'est pas encore sorti. Elles n'apparaissent que sur le **graphe de projection** (cf. section suivante), en rouge sur leur mois.
- La carte du modal est `max-h-[88vh] overflow-y-auto` : sans ça, une liste de 4 échéances déborde l'écran mobile et le bouton Enregistrer devient inaccessible.

### Dépenses programmées (dashboard)

Une facture connue d'avance mais **hors prévisionnel** (régularisation, avis ponctuel…) se saisit depuis le dashboard : quick action **Dépenses** → bouton « Prélèvement à venir ? », qui déplie la **même liste d'échéances** que les provisions (`dueDraft`, une ou plusieurs dates). Sans échéance saisie → dépense immédiate, comme avant.

- Rangées dans `annualExpenses` avec **`noProvision: true`** : elles réutilisent toute la mécanique des échéances (jour J, graphe) mais sont **exclues de `totalAnnual`, de la provision mensuelle, du virement et de `accProvisionAt`** (filtre `provisions` dans `totals`). Aucune colonne ajoutée.
- Affichées sur le **dashboard** en section « Prélèvements à venir » (rose), éditables / supprimables ; `provisionItems` les tient **hors** de la liste Provisions Annuelles de l'onglet Charges communes (le `Reorder.Group` y réinjecte les `noProvision` à la fin pour ne pas les perdre).

### Avances : nouvelle ou cumul

Les deux modals d'avance (`pending` sur le dashboard, `savings_advance` sur l'épargne) s'ouvrent sur une rangée de puces : **`+ Nouvelle`** (sélection par défaut = comportement historique) puis une puce par avance déjà ouverte, avec son montant. Sélectionner une avance existante bascule le modal en **cumul** : le montant saisi s'**ajoute** à `amount` au lieu de créer une ligne.

- État porté par `form.targetPending` (id de l'avance ciblée, `''` = nouvelle). Il n'est jamais persisté : les `setForm` remplacent l'objet entier, et les deux boutons d'ouverture réinitialisent le formulaire pour ne pas garder une cible collée.
- En mode cumul, le champ **Libellé** est masqué (il vient de l'avance) et, côté épargne, le sélecteur **Compte Cible** aussi — le compte est déjà porté par `targetAccountId`, et c'est lui qui est re-débité du montant ajouté. Un bandeau ambre affiche `ancien → nouveau` en direct pendant la frappe.
- Création **et** cumul écrivent une ligne dans `history` avec le type **`advance`** (libellés `Avance:` / `Ajout avance:`, préfixe ` Épargne` côté épargne). Le Journal rend ce type en **ambre** avec l'icône `Coins` et un signe **négatif** (une avance sort du cash). Ce type n'est adossé à aucun tableau de flux : supprimer la ligne du Journal retire l'écriture sans toucher à l'avance elle-même (elle peut déjà avoir été remboursée en partie).

### Datation des flux et graphe de projection

Chaque flux porte son jour réel, ce qui le place sur le **bon mois** du graphe — y compris quand il est saisi après coup.

- **`paidOn`** (`YYYY-MM-DD`) est écrit à la création de chaque dépense / recette. Pour une échéance posée au jour J, `paidOn` = **le jour du prélèvement**, pas le jour de la saisie : une échéance datée du passé creuse bien son mois d'origine.
- **`flowOn(x)`** (portée module) rend la date d'un flux : `paidOn` s'il existe, sinon repli sur `x.id` (un `Date.now()` de création) — ce qui **date correctement tout l'historique antérieur**. Sans repli exploitable → `null` : le flux est appliqué sur les 12 mois, comme avant la datation.
- **Projection** : pour chaque mois, `solde` = provisions cumulées + recettes du mois et des précédentes − dépenses des mois précédents − avances, moins ce que le mois consomme. La barre est **empilée** : vert = solde restant, **rouge (`gDue`, `stackId="p"`) = ce que le mois consomme** (dépenses réelles + échéances encore armées). Un flux antérieur à l'année en cours est acquis dès janvier ; un flux postérieur est hors graphe. Tooltip dédié : `ProjectionTooltip` (portée module).
- **`realCash` est inchangé** (il somme tout, sans regarder les dates) et **coïncide désormais avec la barre du mois courant**, aux échéances non encore échues près.

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

### Immobilier (page dédiée)

- **Actif net** = `value − CRD − IRA − releaseFees` (« net vendeur » : ce qui reste en poche si on vendait aujourd'hui), où le capital restant dû (CRD) vient d'un **tableau d'amortissement régénéré** par `buildSchedule(loan)` ([`src/realestate.js`](src/realestate.js)) : intérêts `round2(crd × taux/12)`, différé = intérêts seuls, dernière ligne solde exactement. Vérifié **au centime** contre le tableau prévisionnel BNP (offre du 31/12/2021 : 301 500 € à 1,20 % sur 300 mois, 2 mois de différé, 1 170,47 €/mois + 77,38 € d'assurance). Les 300 lignes ne sont donc pas embarquées.
- **Calendrier** : `firstDue` (`YYYY-MM-DD`) = date de l'échéance n° 1 **et** jour de prélèvement ; échéance n = `firstDue + (n − 1) mois`. `paidCount(loan, today)` compte les échéances atteintes (avant le jour de prélèvement, le mois courant n'est pas compté). Calage validé : **07/03/2022 = échéance 1** (différé) → premier amortissement 07/05/2022, fin 07/02/2047. Si ce calage est faux, changer la date dans le modal suffit.
- **Frais de vente** déduits de l'actif net (et de chaque point du graphe) : **IRA** (`iraFor`) = min(semestre d'intérêts au taux du prêt sur le CRD, 3 % du CRD), nulle une fois `loan.iraFreeAfter` échéances payées (180 = « gratuit à l'issue de la 15e année », offre p.7) ; **mainlevée** de l'hypothèque de rang 1 (offre p.8) = `item.releaseFees`, montant en € éditable (défaut 1 055 € ≈ 0,35 % du capital, ordre de grandeur). `grossEquity` = `value − CRD` reste disponible si besoin.
- **Lecture du crédit** (le seuil de rentabilité achat/location a été **retiré** en sept. 2026, ainsi que les champs `rent` / `ownerCosts` du modal) :
  - Carte **« Vous vous enrichissez de »** = part capital du prochain prélèvement (épargne) vs **coût réel** = intérêts + assurance, avec barre du % d'épargne dans la mensualité.
  - **Jalons** (`milestones`) : moitié du bien à vous (1re échéance où `valeur − CRD ≥ valeur / 2`), fin de l'IRA (échéance `iraFreeAfter`), fin du crédit.
  - **Coût du crédit payé** (`costPaid`) vs `totalCost` sur toute la durée.
  - Graphe à 2 onglets (state `reView`, non persisté) : **Mensualités** = `BarChart` empilé par année (`years` : capital violet / intérêts rouge / assurance gris, année en cours plus claire, tooltip `RealEstateYearTooltip`) ; **Propriété** = `AreaChart` empilé « à vous » (`owned` = valeur − CRD) + « banque » (`crd`), `ReferenceLine` aujourd'hui et 50 %, tooltip `RealEstateOwnTooltip` (affiche aussi l'actif net vendeur).
  - **Revalorisation simulée** : curseur −2 % → +3 %/an (state `reGrowth`, **jamais enregistré**), passé en 3e argument de `realEstateStats(item, today, growth)`. Ne s'applique qu'aux échéances **futures** (`value × (1+g)^((n − paid)/12)`) : l'actif net du jour ne dépend pas du curseur. Modifie la Propriété, le jalon 50 % et les cartes « Actif net fin 2030 / 2035 » (`netInYear`).
- Tout est dérivé au rendu (`realEstateStats`, dans un `useMemo`) : aucun `useEffect`, aucune écriture en base au fil des mois. **N'entre dans aucun autre calcul** (ni Cash Dispo, ni virement, ni Épargne, ni Crypto).
- **Apport** (15 486,41 €, plan de financement) = stat seulement (« fonds propres investis » = apport + capital remboursé ; « part de l'apport » = apport / (capital + apport)). Il **n'est pas ajouté** à l'actif net.
- Page : héro actif net, barre de progression du capital, grille de stats (CRD, LTV, fonds propres, part apport, intérêts et assurance payés, mensualité, échéances restantes), prochain prélèvement, carte enrichissement, jalons, coût du crédit, graphe Mensualités / Propriété, curseur de revalorisation, bloc « Mon bien » → modal `realestate` (12 champs, `form`), enregistré par `handleRealEstateSave` (édition en place). Sans bien : état vide + bouton Configurer pré-rempli avec `REALESTATE_DEFAULTS`.
- Sur la page **Épargne**, une section « Patrimoine immobilier » (violet) s'affiche **tout en bas de la liste des comptes, avant les avances** : ligne « Actif net immobilier » (clic → onglet Immobilier ; de même, la ligne Crypto de cette liste ouvre l'onglet Crypto au clic) + sous-total **Patrimoine total** = `savingsTotal + cryptoTotal + netAsset`. La carte héro « Épargne Totale » reste `savingsTotal + cryptoTotal` : c'est la « vraie » épargne disponible sur les comptes, l'immobilier n'y entre pas.
- Hors périmètre pour l'instant : plusieurs biens, remboursements anticipés / modulation (à ranger dans `loan.extra` le jour venu, pas de colonne).

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

`neon-pulse` (dans [`src/index.css`](src/index.css)) = liseré lumineux qui tourne lentement (conic-gradient floutée, 7 s) + halo ambiant coloré + liseré de verre. Variantes de couleur via classe additionnelle : `neon-pulse-cyan` (Épargne), `neon-pulse-green` (pointage payé), `neon-pulse-orange` (Crypto), `neon-pulse-pink` (Charges communes), `neon-pulse-ruby` (Perso), `neon-pulse-platinum` (Journal), `neon-pulse-amethyst` (Immobilier) ; défaut = **émeraude → menthe** (thème « Émeraude » choisi en août 2026, tout l'ancien violet/indigo a été remplacé).

**Code couleur par page** (validé août 2026) : Dashboard = émeraude · Charges communes = **rose** (section Mensuel Fixe) + **or/ambre** (section Provisions Annuelles, avec équivalent `/mois` affiché) · Perso = **rubis** (check « payé » reste vert néon) · Épargne = cyan · Crypto = orange · Immobilier = **améthyste** (violet, seule teinte encore libre ; le bleu est exclu car trop proche du cyan) · Journal = **platine** (flux : rouge = paiement, émeraude = recette, teal = autre). La nav reflète la couleur de chaque page sur l'onglet actif. L'ambre reste aussi la couleur des Avances (partout). Couleurs pilotées par les vars `--neon-1/2/-glow`. Respecte `prefers-reduced-motion` (rotation figée). Pour un nouvel univers de couleur, ajouter une variante `.neon-pulse-xxx` plutôt que de bricoler inline.

## Pièges connus

- Un seul fichier composant : les states mappent 1:1 aux colonnes DB. Ajouter une donnée = l'imbriquer dans un JSON existant, **pas** une nouvelle colonne.
- Les champs texte (Km essence, commentaire perso, parts) reposent sur l'auto-save anti-rebond.
- Fichiers hors périmètre app à ne pas relinter/committer : aucun (les vieux `App.jsx.bak/-test/_temp` ont été supprimés).
