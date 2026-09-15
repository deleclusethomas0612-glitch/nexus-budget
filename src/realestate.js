// Patrimoine immobilier : tableau d'amortissement régénéré depuis les paramètres du
// prêt (vérifié au centime contre le tableau prévisionnel BNP), dates d'échéance et
// stats dérivées. Aucune dépendance React : testable par un simple script node.

// Valeurs de l'offre de prêt BNP (31/12/2021) + plan de financement (14/12/2021).
// Premier prélèvement constaté le 07/03/2022 = échéance n° 1 (différé).
export const REALESTATE_DEFAULTS = {
  name: 'Appartement',
  value: 300000,
  apport: 15486.41,
  loan: { principal: 301500, rate: 1.2, payment: 1170.47, insurance: 77.38, deferred: 2, months: 300, firstDue: '2022-03-07' },
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
    next,
    remaining: schedule.length - paid,
    lastPaidDate: paid > 0 ? dueDate(loan, paid) : null,
    endDate: schedule.length ? dueDate(loan, schedule.length) : null,
    totalCost: round2(schedule.reduce((s, r) => s + r.interest + r.insurance, 0)),
    // Points du graphe sur toute la durée du prêt : un par échéance.
    chart: schedule.map(r => ({ n: r.n, date: dueDate(loan, r.n), net: Math.round(value - r.crd), crd: Math.round(r.crd) })),
  };
};
