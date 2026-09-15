# Page Immobilier — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un onglet « Immobilier » qui affiche l'actif net (valeur du bien − CRD) recalculé chaque mois depuis un tableau d'amortissement régénéré.

**Architecture:** Les fonctions pures (tableau d'amortissement, dates d'échéance, stats) vivent dans un nouveau module `src/realestate.js` sans dépendance React, vérifiable par un script node contre le PDF. `App.jsx` stocke le bien dans `savingsAccounts` avec `kind:'realestate'`, l'exclut de l'Épargne, et rend la page + le modal.

**Tech Stack:** React 19, recharts (AreaChart), lucide-react, Tailwind v4, Supabase (colonne `savings_accounts` existante).

Spec : `docs/superpowers/specs/2026-09-15-immobilier-design.md`.

---

### Task 1 : module de calcul `src/realestate.js`

**Files:** Create `src/realestate.js`

- [ ] Écrire le module :

```js
// Patrimoine immobilier : tableau d'amortissement régénéré depuis les paramètres du
// prêt (vérifié au centime contre le tableau prévisionnel BNP), dates d'échéance et
// stats dérivées. Aucune dépendance React : testable par un simple script node.

// Valeurs de l'offre de prêt BNP (31/12/2021) + plan de financement (14/12/2021).
export const REALESTATE_DEFAULTS = {
  name: 'Appartement', value: 300000, apport: 15486.41,
  loan: { principal: 301500, rate: 1.2, payment: 1170.47, insurance: 77.38, deferred: 2, months: 300, firstDue: '2022-03-07' },
};

export const isRealEstate = (a) => a?.kind === 'realestate';
// Compte épargne « argent » : ni crypto, ni bien immobilier.
export const isMoneyAccount = (a) => a?.kind !== 'crypto' && a?.kind !== 'realestate';

const round2 = (x) => Math.round(x * 100) / 100;

// Lignes { n, interest, capital, insurance, crd } pour n = 1..months.
export const buildSchedule = (loan) => {
  const months = Math.max(0, Math.floor(Number(loan.months) || 0));
  const deferred = Math.max(0, Math.floor(Number(loan.deferred) || 0));
  const r = (Number(loan.rate) || 0) / 100 / 12;
  const payment = Number(loan.payment) || 0;
  const insurance = Number(loan.insurance) || 0;
  let crd = round2(Number(loan.principal) || 0);
  const rows = [];
  for (let n = 1; n <= months; n++) {
    const interest = round2(crd * r);
    let capital = 0;
    if (n > deferred) {
      capital = n === months ? crd : Math.min(crd, round2(payment - interest));
      crd = round2(crd - capital);
    }
    rows.push({ n, interest, capital, insurance, crd });
  }
  return rows;
};

// Date de l'échéance n : firstDue + (n − 1) mois, même jour (heure locale, midi).
export const dueDate = (loan, n) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(loan.firstDue || '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1 + (n - 1), Number(m[3]), 12);
};

// Nombre d'échéances dont la date est atteinte, borné à [0, months].
export const paidCount = (loan, today = new Date()) => {
  const first = dueDate(loan, 1);
  const months = Math.max(0, Math.floor(Number(loan.months) || 0));
  if (!first) return 0;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  let k = (t.getFullYear() - first.getFullYear()) * 12 + (t.getMonth() - first.getMonth()) + 1;
  if (t.getDate() < first.getDate()) k -= 1;
  return Math.min(months, Math.max(0, k));
};

export const realEstateStats = (item, today = new Date()) => {
  const loan = item.loan || {};
  const schedule = buildSchedule(loan);
  const paid = paidCount(loan, today);
  const principal = Number(loan.principal) || 0;
  const value = Number(item.value) || 0;
  const apport = Number(item.apport) || 0;
  const crd = paid > 0 ? schedule[paid - 1].crd : principal;
  const done = schedule.slice(0, paid);
  const interestPaid = round2(done.reduce((s, r) => s + r.interest, 0));
  const insurancePaid = round2(done.reduce((s, r) => s + r.insurance, 0));
  const capitalPaid = round2(principal - crd);
  const next = paid < schedule.length ? { ...schedule[paid], date: dueDate(loan, paid + 1) } : null;
  return {
    schedule, paid, crd, capitalPaid, interestPaid, insurancePaid,
    netAsset: Math.round(value - crd),
    ltv: value > 0 ? (crd / value) * 100 : 0,
    progress: principal > 0 ? (capitalPaid / principal) * 100 : 0,
    equityInvested: round2(apport + capitalPaid),
    apportShare: principal + apport > 0 ? (apport / (principal + apport)) * 100 : 0,
    next, remaining: schedule.length - paid,
    lastPaidDate: paid > 0 ? dueDate(loan, paid) : null,
    endDate: schedule.length ? dueDate(loan, schedule.length) : null,
    totalCost: round2(schedule.reduce((s, r) => s + r.interest + r.insurance, 0)),
    // Points du graphe 25 ans : un par échéance.
    chart: schedule.map(r => ({ n: r.n, date: dueDate(loan, r.n), net: Math.round(value - r.crd), crd: Math.round(r.crd) })),
  };
};
```

- [ ] Vérifier contre le PDF avec un script node (scratchpad) :

```js
import { buildSchedule, paidCount, REALESTATE_DEFAULTS as D } from './src/realestate.js';
const s = buildSchedule(D.loan);
const exp = { 3: 300631.03, 29: 277730.22, 55: 254226.47, 113: 199541.16, 155: 157914.95, 239: 69232.06, 300: 0 };
for (const [n, crd] of Object.entries(exp)) console.log(n, s[n - 1].crd === crd ? 'OK' : `KO ${s[n - 1].crd}`);
console.log(paidCount(D.loan, new Date(2022, 2, 6)), '=0', paidCount(D.loan, new Date(2022, 2, 7)), '=1',
  paidCount(D.loan, new Date(2026, 8, 15)), '=55', paidCount(D.loan, new Date(2050, 0, 1)), '=300');
```

Attendu : 7 × OK, puis `0 =0 1 =1 55 =55 300 =300`.

### Task 2 : variante couleur `neon-pulse-amethyst`

**Files:** Modify `src/index.css:102` (après `.neon-pulse-platinum`)

- [ ] Ajouter : `.neon-pulse-amethyst { --neon-1: #c4b5fd; --neon-2: #8b5cf6; --neon-glow: rgba(139, 92, 246, 0.30); }`

### Task 3 : exclure le bien de l'Épargne (`App.jsx`)

**Files:** Modify `src/App.jsx`

- [ ] Importer : `import { REALESTATE_DEFAULTS, isRealEstate, isMoneyAccount, realEstateStats } from './realestate';`
- [ ] `savingsTotal` (l.473) : `savingsAccounts.filter(isMoneyAccount)`.
- [ ] `savingsDisplay` (l.573-578) : `else if (!isRealEstate(a)) savingsDisplay.push(a);`
- [ ] `reorderSavings` : réinjecter le bien pour ne pas le perdre :
  `setSavingsAccounts([...newList.flatMap(item => (item === CRYPTO_ROW ? cryptoAssets : [item])), ...savingsAccounts.filter(isRealEstate)])`
- [ ] Sélecteur *Compte Cible* (l.1592) : `savingsAccounts.filter(isMoneyAccount)`.

### Task 4 : état, stats et modal `realestate` (`App.jsx`)

- [ ] Après le bloc crypto (≈ l.655) :

```js
  // --- IMMOBILIER (stocké dans savings_accounts avec kind:'realestate', page dédiée) ---
  const realEstate = savingsAccounts.find(isRealEstate) || null;
  const reStats = useMemo(() => (realEstate ? realEstateStats(realEstate) : null), [realEstate]);
  const openRealEstate = () => {
    const src = realEstate || REALESTATE_DEFAULTS;
    setForm({
      label: src.name, amount: String(src.value), apport: String(src.apport),
      principal: String(src.loan.principal), rate: String(src.loan.rate), payment: String(src.loan.payment),
      insurance: String(src.loan.insurance), deferred: String(src.loan.deferred), months: String(src.loan.months),
      firstDue: src.loan.firstDue, cat: 'fixed', targetAccount: '', startDate: '',
    });
    setModal({ open: true, type: 'realestate', data: realEstate });
  };
  const handleRealEstateSave = () => {
    const num = (k) => parseFloat(String(form[k] ?? '').replace(',', '.'));
    const value = num('amount'), principal = num('principal'), payment = num('payment'), months = Math.floor(num('months'));
    if (!(value > 0) || !(principal > 0) || !(payment > 0) || !(months > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(form.firstDue || '')) return;
    const item = {
      id: realEstate?.id ?? Date.now(), kind: 'realestate', name: (form.label || '').trim() || 'Bien immobilier',
      value, apport: num('apport') || 0,
      loan: { principal, rate: num('rate') || 0, payment, insurance: num('insurance') || 0,
        deferred: Math.max(0, Math.floor(num('deferred') || 0)), months, firstDue: form.firstDue },
    };
    setSavingsAccounts(realEstate ? savingsAccounts.map(a => (a.id === realEstate.id ? item : a)) : [...savingsAccounts, item]);
    setModal({ open: false, type: '', data: null });
    setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '', startDate: '' });
  };
```

- [ ] `handleForm` : ajouter `if (modal.type === 'realestate') { handleRealEstateSave(); return; }` à côté du cas crypto.
- [ ] Titre du modal : ajouter `modal.type === 'realestate' ? 'Mon bien'`.
- [ ] Champs du modal (avant le bouton, à côté du bloc crypto) : 10 champs `input` (nom text, valeur, apport, capital, taux, mensualité, assurance, différé, échéances en `inputMode="decimal"`, date en `type="date"`), pilotés par `form`, style des autres inputs (`bg-black/40 border border-white/10 rounded-2xl px-5 py-4 font-bold`).
- [ ] Bouton : `modal.type === 'realestate' ? <button type="button" onClick={handleRealEstateSave} className="... bg-violet-600 ...">Enregistrer</button>`.

### Task 5 : page, onglet, nav (`App.jsx`)

- [ ] `tabs` : `['dashboard', 'expenses', 'personal', 'savings', 'crypto', 'realestate', 'history']`.
- [ ] Imports : lucide `Building2` ; recharts `AreaChart, Area, YAxis, ReferenceLine`.
- [ ] `RealEstateTooltip` (portée module, à côté de `ProjectionTooltip`) : mois/année, actif net (violet), CRD (zinc).
- [ ] Page `{activeTab === 'realestate' && (...)}` après la page crypto : état vide (bouton Configurer) ou héro + barre + grille de stats + prochaine échéance + graphe + bloc « Mon bien », selon la spec.
- [ ] Nav : bouton `Building2`, actif `text-violet-400`, entre Crypto et Journal.

### Task 6 : vérification et livraison

- [ ] `npm run build` puis `npm run lint` : zéro erreur.
- [ ] Contrôle visuel (dev server, viewport mobile) : page vide → Configurer → page remplie ; Épargne inchangée ; Compte Cible sans le bien ; swipe.
- [ ] Mettre à jour `CLAUDE.md` (onglets, table de stockage, section Immobilier, couleur).
- [ ] Commit (message français + Co-Authored-By) et push `main`.
