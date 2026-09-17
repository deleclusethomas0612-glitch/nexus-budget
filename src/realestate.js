// Patrimoine immobilier : tableau d'amortissement régénéré depuis les paramètres du
// prêt (vérifié au centime contre le tableau prévisionnel BNP), dates d'échéance et
// stats dérivées. Aucune dépendance React : testable par un simple script node.

// Valeurs de l'offre de prêt BNP (31/12/2021) + plan de financement (14/12/2021).
// Premier prélèvement constaté le 07/03/2022 = échéance n° 1 (différé).
// Frais de sortie en cas de vente : indemnité de remboursement anticipé (IRA, offre
// p.7 : un semestre d'intérêts au taux du crédit, plafonné à 3 % du CRD, gratuite à
// l'issue de la 15e année de remboursement) + mainlevée de l'hypothèque de rang 1
// (offre p.8), estimée ~0,35 % du capital emprunté (ordre de grandeur, éditable).
export const REALESTATE_DEFAULTS = {
  name: 'Appartement',
  value: 300000,
  apport: 15486.41,
  releaseFees: 1055,
  loan: { principal: 301500, rate: 1.2, payment: 1170.47, insurance: 77.38, deferred: 2, months: 300, firstDue: '2022-03-07', iraFreeAfter: 180 },
};

// Indemnité de remboursement anticipé sur un CRD donné après `paid` échéances :
// min(semestre d'intérêts, 3 % du CRD), nulle une fois `iraFreeAfter` échéances payées.
export const iraFor = (loan, crd, paid) => {
  const freeAfter = Number(loan.iraFreeAfter);
  if (Number.isFinite(freeAfter) && freeAfter > 0 && paid >= freeAfter) return 0;
  const semester = crd * ((Number(loan.rate) || 0) / 100) / 2;
  return Math.round(Math.min(semester, crd * 0.03) * 100) / 100;
};

export const isRealEstate = (a) => a?.kind === 'realestate';
// Compte épargne « argent » : ni crypto, ni bien immobilier.
export const isMoneyAccount = (a) => a?.kind !== 'crypto' && a?.kind !== 'realestate';

const round2 = (x) => Math.round(x * 100) / 100;

// Lignes { n, interest, capital, insurance, crd } pour n = 1..months.
// Pendant le différé : intérêts seuls, le capital ne bouge pas. Dernière ligne :
// le capital solde exactement le restant dû.
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

// Nombre d'échéances dont la date est atteinte, borné à [0, months]. Avant le jour
// de prélèvement, le mois courant n'est pas compté.
export const paidCount = (loan, today = new Date()) => {
  const first = dueDate(loan, 1);
  const months = Math.max(0, Math.floor(Number(loan.months) || 0));
  if (!first) return 0;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  let k = (t.getFullYear() - first.getFullYear()) * 12 + (t.getMonth() - first.getMonth()) + 1;
  if (t.getDate() < first.getDate()) k -= 1;
  return Math.min(months, Math.max(0, k));
};

// `growth` = revalorisation annuelle du bien en % (curseur de la page, non enregistré).
// Elle ne s'applique qu'aux échéances futures : aujourd'hui la valeur reste celle
// saisie, donc l'actif net du jour ne dépend pas du curseur.
export const realEstateStats = (item, today = new Date(), growth = 0) => {
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
  const releaseFees = Number(item.releaseFees) || 0;
  const ira = iraFor(loan, crd, paid);
  const g = (Number(growth) || 0) / 100;
  const valueAt = (n) => value * Math.pow(1 + g, Math.max(0, n - paid) / 12);

  // Points mensuels : valeur (revalorisée), part possédée (valeur − CRD), actif net
  // « net vendeur » (− IRA − mainlevée). `ownPct` / `bankPct` = répartition du bien en %
  // (somme 100, la banque plafonnée à 100 % tant que le CRD dépasse la valeur).
  const chart = schedule.map(r => {
    const v = valueAt(r.n);
    const ownPct = v > 0 ? Math.round(Math.min(100, Math.max(0, (v - r.crd) / v * 100)) * 10) / 10 : 0;
    return {
      n: r.n, date: dueDate(loan, r.n),
      value: Math.round(v),
      ownPct, bankPct: Math.round((100 - ownPct) * 10) / 10,
      owned: Math.round(Math.max(0, v - r.crd)),
      crd: Math.round(r.crd),
      net: Math.round(v - r.crd - iraFor(loan, r.crd, r.n) - releaseFees),
    };
  });

  // Barres annuelles : où part la mensualité (capital = enrichissement, intérêts et
  // assurance = coût du crédit).
  const byYear = new Map();
  schedule.forEach(r => {
    const y = dueDate(loan, r.n)?.getFullYear() ?? 0;
    const row = byYear.get(y) || { year: y, capital: 0, interest: 0, insurance: 0 };
    row.capital += r.capital; row.interest += r.interest; row.insurance += r.insurance;
    byYear.set(y, row);
  });
  const years = [...byYear.values()].map(r => ({
    year: r.year, capital: Math.round(r.capital), interest: Math.round(r.interest), insurance: Math.round(r.insurance),
  }));

  // Jalons : moitié du bien à nous (au sens valeur − CRD), fin de l'IRA, fin du crédit.
  const half = chart.find(p => p.owned >= p.value / 2) || null;
  const freeAfter = Math.floor(Number(loan.iraFreeAfter) || 0);
  const milestones = [
    { key: 'half', label: 'Moitié du bien à vous', n: half?.n ?? null, date: half?.date ?? null },
    { key: 'ira', label: "Plus d'indemnité de RA", n: freeAfter > 0 ? freeAfter : null, date: freeAfter > 0 ? dueDate(loan, freeAfter) : null },
    { key: 'end', label: 'Fin du crédit', n: schedule.length || null, date: schedule.length ? dueDate(loan, schedule.length) : null },
  ].map(m => ({ ...m, done: m.n != null && m.n <= paid }));

  // Actif net projeté fin d'année (dernière échéance de l'année, ou la fin du crédit),
  // de l'année en cours à la dernière : points de la mini-courbe de revalorisation.
  const lastOfYear = new Map();
  chart.forEach(p => { if (p.date) lastOfYear.set(p.date.getFullYear(), p.net); });
  const netYears = [...lastOfYear.entries()]
    .filter(([y]) => y >= today.getFullYear())
    .map(([year, net]) => ({ year, net }));

  return {
    schedule, paid, crd, capitalPaid, interestPaid, insurancePaid,
    // Actif net « dans la poche » si vente aujourd'hui : valeur − CRD − IRA − mainlevée.
    grossEquity: Math.round(value - crd),
    ira, releaseFees,
    netAsset: Math.round(value - crd - ira - releaseFees),
    ltv: value > 0 ? (crd / value) * 100 : 0,
    progress: principal > 0 ? (capitalPaid / principal) * 100 : 0,
    equityInvested: round2(apport + capitalPaid),
    apportShare: principal + apport > 0 ? (apport / (principal + apport)) * 100 : 0,
    next,
    remaining: schedule.length - paid,
    lastPaidDate: paid > 0 ? dueDate(loan, paid) : null,
    endDate: schedule.length ? dueDate(loan, schedule.length) : null,
    totalCost: round2(schedule.reduce((s, r) => s + r.interest + r.insurance, 0)),
    costPaid: round2(interestPaid + insurancePaid),
    chart, years, milestones, netYears,
  };
};
