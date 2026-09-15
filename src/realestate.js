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
  // Loyer de référence : ce qu'il aurait fallu payer pour se loger sans acheter.
  // Défaut = la mensualité assurance comprise (1 170,47 + 77,38).
  rent: 1247.85,
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
  const releaseFees = Number(item.releaseFees) || 0;
  const ira = iraFor(loan, crd, paid);

  // Points du graphe + seuil de rentabilité, en une passe.
  // `seuil` = prix de vente minimum pour ne rien perdre à l'échéance n. Le capital
  // remboursé n'y figure pas : ce n'est pas une perte mais de l'épargne, et il
  // s'annule entre le net vendeur et l'argent investi. Ne restent que l'apport, les
  // intérêts et l'assurance déjà payés, plus les frais de sortie.
  // `seuilNet` déduit en plus les loyers qu'on n'a pas payés en étant propriétaire :
  // c'est la comparaison « acheter plutôt que louer », la seule qui ait un sens, car
  // se loger coûte de toute façon. `seuil` garde la lecture brute (placement pur).
  const rent = Number(item.rent) || 0;
  let cumI = 0, cumS = 0;
  const chart = schedule.map(r => {
    cumI = round2(cumI + r.interest);
    cumS = round2(cumS + r.insurance);
    const rowIra = iraFor(loan, r.crd, r.n);
    const seuil = Math.round(principal + apport + cumI + cumS + rowIra + releaseFees);
    return {
      n: r.n, date: dueDate(loan, r.n),
      net: Math.round(value - r.crd - rowIra - releaseFees),
      crd: Math.round(r.crd),
      seuil,
      seuilNet: Math.round(seuil - rent * r.n),
    };
  });

  // Équilibre évalué au prix de vente saisi, sans hypothèse de revalorisation.
  // `since` = 1re échéance où la vente couvre tout ce qui a été investi (null = jamais).
  const here = chart.length ? chart[Math.min(chart.length, Math.max(1, paid)) - 1] : null;
  const readAt = (key) => {
    const threshold = here ? here[key] : 0;
    return { threshold, gain: Math.round(value - threshold), missing: Math.max(0, Math.round(threshold - value)), since: chart.find(p => value >= p[key]) || null };
  };
  const gross = readAt('seuil');
  const withRent = readAt('seuilNet');

  return {
    rent,
    rentAvoided: Math.round(rent * paid),
    // Lecture brute (placement pur) et lecture nette du loyer de référence.
    threshold: gross.threshold, gain: gross.gain, missing: gross.missing, since: gross.since,
    thresholdNet: withRent.threshold, gainNet: withRent.gain, missingNet: withRent.missing, sinceNet: withRent.since,
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
    chart,
  };
};
