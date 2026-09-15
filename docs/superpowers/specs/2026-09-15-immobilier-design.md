# Page « Immobilier » — actif net du patrimoine immobilier

Date : 15 septembre 2026. Statut : validé (implémentation le 15/09/2026).

## Objectif

Une 7e page qui affiche, mois après mois, l'**actif net immobilier** du couple :
valeur du bien − capital restant dû (CRD) du crédit BNP, plus quelques stats
(part de l'apport, capital remboursé, LTV, intérêts payés, fin de prêt) et une
courbe sur les 25 ans du prêt. La page se met à jour seule le **7 de chaque
mois** (jour de prélèvement, porté par la date de 1re échéance) à partir d'un tableau d'amortissement **recalculé**
depuis les paramètres du prêt. Elle n'entre dans **aucun** autre calcul de
l'app (ni Cash Dispo, ni virement, ni Épargne, ni Crypto).

## Données source (offre de prêt BNP du 31/12/2021 + plan de financement du 14/12/2021)

| Paramètre | Valeur | Origine |
|---|---|---|
| Prix d'acquisition | 290 000 € | plan de financement |
| Frais de notaire financés | 11 500 € | plan de financement |
| Capital emprunté (`principal`) | 301 500 € | offre |
| Taux fixe annuel hors assurance (`rate`) | 1,20 % | offre |
| Mensualité hors assurance (`payment`) | 1 170,47 € | offre p.4 |
| Assurance groupe (`insurance`) | 77,38 €/mois | offre p.4 (2 × 0,154 %) |
| Différé (`deferred`) | 2 échéances (intérêts seuls 301,50 €) | offre p.4 |
| Nombre d'échéances (`months`) | 300 (25 ans) | tableau prévisionnel |
| Fonds propres / apport (`apport`) | 15 486,41 € | plan de financement (hors bien, frais annexes) |
| Valeur du bien (`value`) | 300 000 € (modifiable) | utilisateur |

Calendrier retenu (validé le 15/09/2026) : **premier prélèvement le
07/03/2022 = échéance n° 1** du tableau (différé). Donc n° 2 = 07/04/2022,
n° 3 = 07/05/2022 (premier amortissement), n° 300 = 07/02/2047. Jour de
prélèvement = **7**, porté par `firstDue` (l'offre indique un arrêté au 5 ;
on suit le constat utilisateur). Si ce calage s'avère faux, il suffit de
changer la date de 1re échéance dans le modal : tout se décale.
Aucun remboursement anticipé, modulation ni suspension depuis 2022.

Vérification faite : le tableau régénéré par la formule ci-dessous coïncide
**au centime** avec le tableau prévisionnel du PDF (lignes 3, 29, 55, 113,
155, 239 comparées ; dernière ligne à 0,00). Il est donc inutile d'embarquer
les 300 lignes en dur.

Position au 15/09/2026 avec ce calendrier : 55 échéances payées,
CRD = 254 226,47 €, capital remboursé = 47 273,53 €, actif net = 45 774 €.

## Stockage (aucune colonne ajoutée)

Même patron que la crypto : un item dans `savingsAccounts` (colonne
`savings_accounts`) avec `kind: 'realestate'`.

```js
{
  id, kind: 'realestate',
  name: 'Appartement',        // libellé libre
  value: 300000,              // valeur du bien, éditable
  apport: 15486.41,           // fonds propres investis hors bien (stat seulement)
  loan: {
    principal: 301500, rate: 1.2, payment: 1170.47, insurance: 77.38,
    deferred: 2, months: 300, firstDue: '2022-03-07'
  }
}
```

- `firstDue` porte à la fois le mois de l'échéance n° 1 **et** le jour de
  prélèvement (7). La date de l'échéance n est `firstDue + (n − 1) mois`,
  même jour.
- Un seul bien géré (YAGNI). La page lit le premier item `kind === 'realestate'`.
  S'il n'existe pas, elle affiche un état vide avec un bouton **Configurer**
  qui ouvre le modal pré-rempli avec les valeurs du tableau ci-dessus.
- Exclusion partout ailleurs : les filtres `kind !== 'crypto'` (total Épargne
  `savingsTotal`, liste Épargne, sélecteur *Compte Cible* des avances) deviennent
  « ni crypto ni realestate ». Introduire un helper module `isMoneyAccount(a)`
  = `a.kind !== 'crypto' && a.kind !== 'realestate'` et l'utiliser aux 3 endroits.
  `cryptoAssets` reste `kind === 'crypto'`, donc rien ne change côté Crypto.

## Calcul (`src/realestate.js`, fonctions pures sans React)

- `buildSchedule(loan)` → tableau de `months` lignes
  `{ n, interest, capital, insurance, crd }` :
  - `r = rate / 100 / 12` ; `interest = round2(crd × r)`.
  - `n ≤ deferred` : `capital = 0`, `crd` inchangé.
  - sinon `capital = round2(payment − interest)` ; dernière ligne :
    `capital = crd` (solde exact) ; `crd = round2(crd − capital)`.
  - `insurance` = constante `loan.insurance`.
- `dueDate(loan, n)` → `Date` de l'échéance n (mois absolus, jour de `firstDue`).
- `paidCount(loan, today)` → nombre d'échéances dont la date ≤ `today`, borné
  à `[0, months]`. Avant le jour de prélèvement, le mois courant n'est pas compté.
- `realEstateStats(item, today)` → objet dérivé, dans un `useMemo` :

| Stat | Formule |
|---|---|
| `crd` | `schedule[paid − 1].crd` (ou `principal` si `paid = 0`) |
| `capitalPaid` | `principal − crd` |
| `interestPaid`, `insurancePaid` | Σ sur les `paid` premières lignes |
| `netAsset` | `round(value − crd)` |
| `ltv` | `crd / value` (%) |
| `progress` | `capitalPaid / principal` (%) |
| `equityInvested` | `apport + capitalPaid` (fonds propres investis) |
| `apportShare` | `apport / (principal + apport)` (%) — part de l'apport dans le coût total 316 986,41 € |
| `next` | ligne `paid + 1` + sa date (null si prêt soldé) |
| `remaining` | `months − paid` |
| `endDate` | `dueDate(loan, months)` |
| `totalCost` | Σ intérêts + Σ assurance sur 300 lignes (info) |

**Seuil de rentabilité (ajout du 15/09/2026)** : `threshold(n) = principal +
apport + Σintérêts(n) + Σassurance(n) + ira(n) + releaseFees`, le prix de vente
minimum pour ne rien perdre. Le capital remboursé en est absent (épargne, pas
perte : il s'annule entre le net vendeur et l'argent investi). `gain = value −
threshold` au prix **saisi**, sans revalorisation ; `breakEven` = 1re échéance
future à l'équilibre, `lastProfitable` = dernière, `missing` = manque. Le seuil
croît (~326 €/mois) donc à valeur figée l'équilibre s'éloigne. Rendu : carte
dédiée + 3e courbe émeraude sur le graphe, croisée par une `ReferenceLine`
horizontale à la valeur du bien.

**Frais de vente (ajout du 15/09/2026, après livraison)** : `netAsset` devient
`value − crd − ira − releaseFees`, le « net vendeur ». `ira = iraFor(loan, crd, paid)`
= min(semestre d'intérêts au taux du prêt, 3 % du CRD), 0 dès `loan.iraFreeAfter`
échéances payées (180). `releaseFees` = frais de mainlevée d'hypothèque, montant
éditable (défaut 1 055 €). Le graphe applique la même déduction à chaque point.
`grossEquity` conserve `value − crd`. La page Épargne affiche aussi ce net
vendeur dans une section « Patrimoine immobilier » sous la liste des comptes.

L'apport **n'entre pas** dans `netAsset` (décision validée : stat seulement).
Aucun `useEffect`, aucune écriture en base : tout se recalcule au rendu à
partir de `new Date()`.

## Page (onglet `realestate`)

Ordre des onglets : `dashboard, expenses, personal, savings, crypto, realestate, history`
(le swipe suit le tableau `tabs`). Icône nav : `Building2` (lucide, `Home` est déjà pris par les icônes de charges). Couleur du
tab actif : `text-violet-400`.

Contenu, de haut en bas, dans le style des autres pages (cartes arrondies,
`neon-pulse`) :

1. **Carte héro** (`neon-pulse neon-pulse-amethyst`) : « Actif net immobilier »,
   `netAsset` en 5xl, sous-titre `valeur − CRD`, et « à jour au 07/09/2026 »
   (date de la dernière échéance comptée). Icône `Building2` dans le carré coloré.
2. **Barre de progression** : capital remboursé / capital emprunté, avec %.
3. **Grille 2 colonnes de stats** : Capital restant dû · LTV · Fonds propres
   investis (`equityInvested`) · Part de l'apport (`apportShare`, avec le
   montant) · Intérêts payés · Assurance payée · Mensualité (1 247,85 dont
   77,38 assurance) · Échéances restantes + date de fin.
4. **Prochaine échéance** : date, montant total, part capital / part intérêts.
5. **Graphe 25 ans** (recharts, `AreaChart`) : un point par échéance
   (300 points), axe X = années (tick tous les 12 points, libellé année),
   série *Actif net* (violet) et *Capital restant dû* (zinc), `ReferenceLine`
   verticale sur l'échéance courante. Tooltip dédié `RealEstateTooltip`
   (portée module) : mois/année, actif net, CRD. Les montants sont en k€ sur
   l'axe Y pour la lisibilité mobile.
6. **Bloc « Mon bien »** : nom, valeur, apport, résumé du prêt ; crayon →
   modal `realestate`.

Aucun bouton MAJ (pas de source externe), pas de drag & reorder.

## Modal `realestate`

Champs (dans `form`, comme les autres modals) : nom, valeur du bien, apport,
capital emprunté, taux annuel (%), mensualité hors assurance, assurance/mois,
mois de différé, nombre d'échéances, date de la 1re échéance (`type="date"`).
Pré-rempli avec l'item existant ou, à la création, avec les valeurs de l'offre.
Enregistrer : nombres parsés en `Number`, refus si valeur, capital, mensualité
ou nombre d'échéances ≤ 0 ou date vide. Édition **en place** (même `id`).
Carte `max-h-[88vh] overflow-y-auto` (10 champs sur mobile).

## Design

Nouvelle variante dans `src/index.css` :
`.neon-pulse-amethyst { --neon-1: #c4b5fd; --neon-2: #8b5cf6; --neon-glow: rgba(139, 92, 246, 0.30); }`
Améthyste = seule teinte encore libre dans la palette (émeraude, rose, or,
rubis, cyan, orange, platine sont prises ; le bleu est exclu car proche du
cyan Épargne). Accents Tailwind : `violet-400/500`, fonds `violet-900/40`.

## Hors périmètre

Plusieurs biens, historique des valorisations, remboursements anticipés,
modulation, revalorisation automatique du bien, impact sur le Cash Dispo.
Si un remboursement anticipé survient un jour, on ajoutera une liste
`loan.extra: [{ date, amount }]` dans l'item (pas de colonne).

## Vérification

- Script node ponctuel : `buildSchedule` contre les lignes 3, 29, 55, 113,
  155, 239, 300 du PDF (attendu : identique au centime, CRD final 0).
- `paidCount` : le 06/03/2022 → 0, le 07/03/2022 → 1, le 15/09/2026 → 55,
  après le 07/02/2047 → 300.
- `npm run build` + `npm run lint` à zéro avant commit.
- Contrôle visuel mobile : page, modal, graphe, swipe vers/depuis Crypto et Journal.
- Épargne : total et liste inchangés après ajout du bien ; *Compte Cible* ne
  propose pas le bien.
