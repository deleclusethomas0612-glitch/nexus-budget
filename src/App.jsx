import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, AreaChart, Area, ReferenceLine } from 'recharts';
import {
  TrendingUp, Users, Wallet, Plus, Check, X, Trash2, Pencil,
  History as HistoryIcon, Zap, HeartPulse,
  Receipt, ArrowDownLeft, ArrowUpRight, Home, Calendar, Coins, LogOut, Loader2, Flame,
  PiggyBank, CheckSquare, MessageSquare, Archive, GripVertical, LineChart, RefreshCw, Bitcoin, CalendarClock, Building2, Settings
} from 'lucide-react';
import { supabase } from './supabase';
import { REALESTATE_DEFAULTS, isRealEstate, isMoneyAccount, realEstateStats } from './realestate';
import { Reorder, useDragControls } from 'framer-motion';

// --- CONTEXTE POUR LES CONTRÔLES DE DRAG ---
const DragContext = React.createContext();

const DraggableItem = ({ children, value }) => {
  const dragControls = useDragControls();
  return (
    <DragContext.Provider value={dragControls}>
      <Reorder.Item
        value={value}
        dragControls={dragControls}
        dragListener={false}
        whileDrag={{ scale: 1.05, zIndex: 100 }}
        className="relative"
      >
        {children}
      </Reorder.Item>
    </DragContext.Provider>
  );
};

const DragHandle = ({ className }) => {
  const dragControls = React.useContext(DragContext);
  // Anti-déplacement accidentel : le drag ne démarre qu'après un appui maintenu
  // (~220 ms) sans bouger. Un geste de scroll qui commence sur la poignée est
  // détecté (mouvement > 8 px avant l'échéance) et annule l'armement.
  const holdTimer = React.useRef(null);
  const startPos = React.useRef(null);
  const cancelHold = () => { if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } };
  return (
    <div
      onPointerDown={(e) => {
        startPos.current = { x: e.clientX, y: e.clientY };
        cancelHold();
        holdTimer.current = setTimeout(() => {
          holdTimer.current = null;
          if (navigator.vibrate) navigator.vibrate(10);
          dragControls.start(e);
        }, 220);
      }}
      onPointerMove={(e) => {
        if (holdTimer.current && startPos.current
          && Math.hypot(e.clientX - startPos.current.x, e.clientY - startPos.current.y) > 8) cancelHold();
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      style={{ touchAction: 'none' }}
      className={`cursor-grab active:cursor-grabbing p-4 -mr-4 flex items-center justify-center z-20 ${className}`}
    >
      <GripVertical size={24} className="text-zinc-500 hover:text-white transition-colors" />
    </div>
  );
};

// Ligne « Crypto » de la page Épargne : sentinelle stable (référence unique) qui
// représente le bloc crypto dans la liste réordonnable. Sa position dans la liste
// est encodée par la place des items kind:'crypto' dans savings_accounts.
const CRYPTO_ROW = { id: 'crypto-row' };

// Supports détenus dans le PEA : code Boursorama + ISIN. Fonds du Plan d'Épargne
// BoursoBank (page OPCVM, table extensible aux 6 autres : Europe, France, Luxe,
// Santé, Tech, Climat) et trackers/ETF cotés (page trackers, code « 1r… »).
const BOURSO_FUNDS = [
  { id: '0P0001US9F', name: 'Bourso Monde', isin: 'FR001400RWK6' },
  { id: '0P0001US9I', name: 'Bourso US', isin: 'FR001400RWL4' },
  { id: '1rTGPEA', name: 'Amundi PEA Global ACWI', isin: 'FR0014017NX3', ticker: 'GPEA' },
];
const fundName = (id) => BOURSO_FUNDS.find(f => f.id === id)?.name || id;

// Cryptos suivies : nom → ticker Coinbase (paire EUR). ASI = FET sur Coinbase.
const CRYPTOS = [
  { sym: 'BTC', name: 'Bitcoin' },
  { sym: 'ADA', name: 'Cardano' },
  { sym: 'FET', name: 'ASI (Fetch.ai)' },
  { sym: 'ONDO', name: 'Ondo' },
  { sym: 'DOT', name: 'Polkadot' },
  { sym: 'ICP', name: 'Internet Computer' },
  { sym: 'JASMY', name: 'Jasmy' },
  { sym: 'ENJ', name: 'Enjin Coin' },
  { sym: 'ATOM', name: 'Cosmos' },
  { sym: 'IMX', name: 'Immutable' },
  { sym: 'GRT', name: 'The Graph' },
];
const cryptoName = (sym) => CRYPTOS.find(c => c.sym === sym)?.name || sym;

// Échéances d'une provision annuelle, normalisées en liste `[{ id, date, amount }]`.
// Rétrocompatible : les provisions armées avant le multi-échéances portent encore
// `dueDate`/`dueAmount` scalaires, relus ici comme une liste à une seule ligne.
const dueList = (e) => {
  if (Array.isArray(e.dueSchedule)) return e.dueSchedule.filter(d => d && d.date);
  if (e.dueDate) return [{ id: e.id, date: e.dueDate, amount: Number(e.dueAmount ?? e.amount) || 0 }];
  return [];
};
const dueTotal = (e) => dueList(e).reduce((s, d) => s + (Number(d.amount) || 0), 0);

// Date du jour au format ISO (YYYY-MM-DD), en heure locale.
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Date réelle d'un flux (dépense / recette), qui sert à le placer sur le bon mois
// du graphe. Les flux enregistrés avant la datation n'ont pas de `paidOn` : on
// retombe sur leur `id`, qui est un `Date.now()` de création. Sans repli
// exploitable → null : le flux est alors appliqué sur tout le graphe, comme avant.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MIN_TS = Date.UTC(2020, 0, 1), MAX_TS = Date.UTC(2100, 0, 1);
const flowOn = (x) => {
  if (typeof x.paidOn === 'string' && ISO_DAY.test(x.paidOn)) return new Date(`${x.paidOn}T12:00:00`);
  const n = Number(x.id);
  if (Number.isFinite(n) && n > MIN_TS && n < MAX_TS) return new Date(n);
  return null;
};

// Tooltip du graphe de projection : solde restant + éventuelle échéance datée du mois.
const ProjectionTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-zinc-950 border border-white/10 rounded-[20px] px-4 py-2.5 shadow-2xl">
      <p className="text-[10px] font-black uppercase text-zinc-500 mb-1">{label}</p>
      <p className="text-sm font-black text-emerald-400">{Number(d.solde).toLocaleString()}€<span className="text-[9px] text-zinc-600 ml-1.5 uppercase">Solde</span></p>
      {d.due > 0 && (
        <p className="text-sm font-black text-rose-400 mt-0.5">-{Number(d.due).toLocaleString()}€<span className="text-[9px] text-zinc-600 ml-1.5 uppercase">{d.dueLabel}</span></p>
      )}
    </div>
  );
};

// Tooltips des graphes Immobilier.
// « Mensualités » : répartition d'une année entre capital (à vous), intérêts et assurance.
const RealEstateYearTooltip = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const total = d.capital + d.interest + d.insurance;
  return (
    <div className="bg-zinc-950 border border-white/10 rounded-[20px] px-4 py-2.5 shadow-2xl">
      <p className="text-[10px] font-black uppercase text-zinc-500 mb-1">{d.year} · {total.toLocaleString()}€</p>
      <p className="text-sm font-black text-violet-300">{d.capital.toLocaleString()}€<span className="text-[9px] text-zinc-600 ml-1.5 uppercase">Capital · {total ? Math.round((d.capital / total) * 100) : 0}% à vous</span></p>
      <p className="text-sm font-black text-rose-400 mt-0.5">{d.interest.toLocaleString()}€<span className="text-[9px] text-zinc-600 ml-1.5 uppercase">Intérêts</span></p>
      <p className="text-sm font-black text-zinc-400 mt-0.5">{d.insurance.toLocaleString()}€<span className="text-[9px] text-zinc-600 ml-1.5 uppercase">Assurance</span></p>
    </div>
  );
};

// « Propriété » : part du bien à vous (valeur − CRD) face à la part de la banque.
const RealEstateOwnTooltip = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-zinc-950 border border-white/10 rounded-[20px] px-4 py-2.5 shadow-2xl">
      <p className="text-[10px] font-black uppercase text-zinc-500 mb-1">{d.date ? d.date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : `#${d.n}`} · {d.value ? Math.round((d.owned / d.value) * 100) : 0}% à vous</p>
      <p className="text-sm font-black text-violet-300">{Number(d.owned).toLocaleString()}€<span className="text-[9px] text-zinc-600 ml-1.5 uppercase">À vous</span></p>
      <p className="text-sm font-black text-zinc-400 mt-0.5">{Number(d.crd).toLocaleString()}€<span className="text-[9px] text-zinc-600 ml-1.5 uppercase">À la banque</span></p>
      <p className="text-sm font-black text-emerald-400 mt-0.5">{Number(d.net).toLocaleString()}€<span className="text-[9px] text-zinc-600 ml-1.5 uppercase">Actif net (vente)</span></p>
    </div>
  );
};

export default function NexusUltimateCloud() {
  // --- AUTH STATE ---
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState(null);

  // --- DATA STATE (MAIN) ---
  const [fixedExpenses, setFixedExpenses] = useState([]);
  const [annualExpenses, setAnnualExpenses] = useState([]);
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [reimbursements, setReimbursements] = useState([]);
  const [exceptionalPaid, setExceptionalPaid] = useState([]);

  // --- DATA STATE (MODULES INDÉPENDANTS) ---
  const [savingsAccounts, setSavingsAccounts] = useState([]);
  const [savingsPending, setSavingsPending] = useState([]);
  const [personalExpenses, setPersonalExpenses] = useState([]);

  // --- UI STATE ---
  const [activeTab, setActiveTab] = useState('dashboard');
  const [modal, setModal] = useState({ open: false, type: '', data: null });
  const [form, setForm] = useState({ label: '', amount: '', cat: 'fixed', targetAccount: '', startDate: '' });
  const [showArchives, setShowArchives] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const [vlMap, setVlMap] = useState({});          // { symbol: { vl, at } } — VL live
  const [vlLoading, setVlLoading] = useState(false);
  const [portfolioDraft, setPortfolioDraft] = useState({}); // { fundId: "parts" } dans la modale
  const [cryptoPrices, setCryptoPrices] = useState({}); // { sym: { price, at } } — cours EUR live
  const [cryptoLoading, setCryptoLoading] = useState(false);
  const [cryptoDraft, setCryptoDraft] = useState({});   // { sym, qty } dans la modale
  const [dueDraft, setDueDraft] = useState([]);         // [{ id, date, amount }] dans la modale Échéances
  const [reView, setReView] = useState('years');       // graphe Immobilier : 'years' (mensualités) | 'own' (propriété)
  const [reGrowth, setReGrowth] = useState(0);         // revalorisation annuelle simulée (%), non enregistrée
  const [reYear, setReYear] = useState(2030);          // année choisie sur la mini-courbe d'actif net, non enregistrée

  const tabs = ['dashboard', 'expenses', 'personal', 'savings', 'crypto', 'realestate', 'history'];

  const handleTouchStart = (e) => {
    // Un geste qui démarre sur un curseur (ou une zone marquée data-no-swipe) le fait
    // glisser : il ne doit pas être pris pour un swipe de changement d'onglet.
    if (e.target.closest?.('input[type="range"], [data-no-swipe]')) { setTouchStart(null); return; }
    setTouchStart({ x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY });
  };

  const handleTouchEnd = (e) => {
    if (!touchStart) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;

    const diffX = touchStart.x - touchEndX;
    const diffY = touchStart.y - touchEndY;
    const currentIndex = tabs.indexOf(activeTab);

    if (Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX > 50 && currentIndex < tabs.length - 1) setActiveTab(tabs[currentIndex + 1]);
      if (diffX < -50 && currentIndex > 0) setActiveTab(tabs[currentIndex - 1]);
    }
    setTouchStart(null);
  };

  // --- 1. INITIALISATION CLOUD ---
  const clearAllStates = () => {
    setFixedExpenses([]);
    setAnnualExpenses([]);
    setPending([]);
    setHistory([]);
    setReimbursements([]);
    setExceptionalPaid([]);
    setSavingsAccounts([]);
    setSavingsPending([]);
    setPersonalExpenses([]);
  };

  const fetchData = async (userId) => {
    setLoading(true);
    clearAllStates(); // Reset avant de charger le nouveau compte
    const { data } = await supabase.from('nexus_data').select('*').eq('user_id', userId).single();

    if (data) {
      setFixedExpenses(data.fixed_expenses || []);
      setAnnualExpenses(data.annual_expenses || []);
      setPending(data.pending || []);
      setHistory(data.history || []);
      setReimbursements(data.reimbursements || []);
      setExceptionalPaid(data.exceptional_paid || []);
      setSavingsAccounts(data.savings_accounts || []);
      setSavingsPending(data.savings_pending || []);
      setPersonalExpenses(data.personal_expenses || []);
    } else {
      // Si pas de données, on s'assure d'insérer une ligne propre si besoin
      const { data: check } = await supabase.from('nexus_data').select('user_id').eq('user_id', userId);
      if (!check || check.length === 0) {
        const defaults = {
          user_id: userId,
          fixed_expenses: [], annual_expenses: [], pending: [], history: [], reimbursements: [], exceptional_paid: [],
          savings_accounts: [], savings_pending: [], personal_expenses: []
        };
        await supabase.from('nexus_data').insert(defaults);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchData(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchData(session.user.id);
      else setLoading(false);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveData = async () => {
    if (!session) return;
    const updates = {
      fixed_expenses: fixedExpenses,
      annual_expenses: annualExpenses,
      pending: pending,
      history: history,
      reimbursements: reimbursements,
      exceptional_paid: exceptionalPaid,
      // Sauvegarde des modules
      savings_accounts: savingsAccounts,
      savings_pending: savingsPending,
      personal_expenses: personalExpenses
    };
    const { error } = await supabase.from('nexus_data').upsert({ user_id: session.user.id, ...updates });
    setSaveError(!!error);
  };

  // Sauvegarde auto avec anti-rebond : les modifications rapprochées (ex. saisie clavier)
  // sont regroupées en une seule écriture, 800 ms après la dernière modification.
  useEffect(() => {
    if (loading || !session) return;
    const timer = setTimeout(() => { saveData(); }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedExpenses, annualExpenses, pending, history, reimbursements, exceptionalPaid, savingsAccounts, savingsPending, personalExpenses]);

  // Échéances échues : quand le jour d'un prélèvement armé sur une provision annuelle
  // est atteint, cette échéance devient une vraie Dépense (Cash Dispo + Journal), puis
  // elle est retirée de la liste — les échéances suivantes (paiement en plusieurs fois)
  // restent armées. La provision, elle, reste en place et continue de cumuler.
  // Le retrait rend l'opération non rejouable (pas de double débit).
  useEffect(() => {
    if (loading || !session) return;
    const now = new Date();
    const isDue = (d) => {
      const t = new Date(`${d.date}T23:59:59`);
      return !isNaN(t) && t <= now;
    };

    const stamped = [];
    let touched = false;
    annualExpenses.forEach(e => {
      dueList(e).forEach(d => {
        if (!isDue(d)) return;
        touched = true;
        stamped.push({
          id: Date.now() + stamped.length,
          // Plusieurs échéances : on numérote pour distinguer les lignes du Journal.
          label: dueList(e).length > 1 ? `${e.name} (${stamped.length + 1}/${dueList(e).length})` : e.name,
          amount: Math.round(Number(d.amount) || 0),
          // `on` = jour réel du prélèvement : c'est lui qui place la dépense sur le
          // bon mois du graphe, même quand l'échéance est saisie après coup.
          on: d.date,
          date: new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
        });
      });
    });
    if (!touched) return;

    setExceptionalPaid(prev => [...stamped.map(({ id, label, amount, on }) => ({ id, label, amount, paidOn: on })), ...prev]);
    setHistory(prev => [...stamped.map(({ id, label, amount, date }) => ({ id, label, amount, date, type: 'payment' })), ...prev]);
    setAnnualExpenses(prev => prev.map(e => {
      const rest = dueList(e).filter(d => !isDue(d));
      if (rest.length === dueList(e).length) return e;
      return { ...e, dueSchedule: rest, dueDate: null, dueAmount: null };
    }));
  }, [annualExpenses, loading, session]);

  // --- 2. AUTHENTIFICATION ---
  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true); setAuthError(null);
    let result;
    if (authMode === 'signup') result = await supabase.auth.signUp({ email, password });
    else result = await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      if (result.error.status === 429) setAuthError("Limite Supabase atteinte. Attendez un peu ou désactivez la confirmation d'email dans le dashboard.");
      else setAuthError(result.error.message);
    }
    else if (authMode === 'signup') setAuthError("Vérifiez vos emails pour confirmer !");
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    clearAllStates();
  };

  // --- 3. LOGIQUE MÉTIER ---
  const totals = useMemo(() => {
    const totalFixed = fixedExpenses.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
    // `annualExpenses` héberge deux choses : les vraies provisions annuelles, et les
    // dépenses programmées depuis le dashboard (`noProvision`), qui portent seulement
    // des échéances datées et n'alimentent NI la provision mensuelle NI le virement.
    const provisions = annualExpenses.filter(e => !e.noProvision);
    const totalAnnual = provisions.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
    // La mensualité (montant/12) est TOUJOURS pleine, quelle que soit la date de démarrage.
    const provision = Math.round(totalAnnual / 12);
    // Charges communes partagées simplement par 2 (foyer à deux), sans exception.
    const virement = Math.ceil((totalFixed + provision) / 2);

    const totalPending = pending.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
    const totalReimbursed = reimbursements.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
    const totalPaid = exceptionalPaid.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);

    const startCash = 0;
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIndex = now.getMonth();

    // Ancre de cumul : janvier 2026 (début du suivi). Le cumul des provisions est
    // CONTINU dans le temps et ne se réinitialise JAMAIS au 1er janvier. Les
    // régularisations annuelles se font manuellement via Dépenses / Recettes.
    const ANCHOR = 2026 * 12; // janvier 2026 en "mois absolus" (année * 12 + mois)
    const absMonth = (year, monthIndex) => year * 12 + monthIndex;

    // Nombre de mois provisionnés pour une charge, à un mois absolu cible :
    // - Sans date : compté en continu depuis l'ancre.
    // - Avec date : compté à partir du mois de démarrage (mois inclus), en continu.
    const monthsFor = (e, target) => {
      if (!e.startDate) return Math.max(0, target - ANCHOR);
      const d = new Date(e.startDate);
      return Math.max(0, target - absMonth(d.getFullYear(), d.getMonth()) + 1);
    };

    const accProvisionAt = (target) => provisions.reduce(
      (acc, e) => acc + ((Number(e.amount) || 0) / 12) * monthsFor(e, target),
      0
    );

    const realCash = Math.round(
      startCash + accProvisionAt(absMonth(currentYear, currentMonthIndex)) + totalReimbursed - totalPaid - totalPending
    );

    // --- GRAPHE DE PROJECTION ---
    // Chaque flux est placé sur SON mois : une dépense de juin ne creuse que juin et
    // les mois suivants, jamais janvier à mai — y compris si elle est saisie plus tard.
    // Les flux sans date exploitable (ni `paidOn` ni `id` timestamp) restent appliqués
    // sur les 12 mois, ce qui reproduit le comportement d'avant la datation.
    const paidByMonth = Array(12).fill(0);
    const reimbByMonth = Array(12).fill(0);
    const paidLabels = Array.from({ length: 12 }, () => []);
    let paidBefore = 0, reimbBefore = 0;

    // Répartit un flux sur son mois. Antérieur à l'année en cours ou non datable
    // → déjà acquis, appliqué dès janvier. Postérieur → hors de ce graphe.
    const spread = (list, byMonth, onBefore, labels) => {
      list.forEach(x => {
        const v = Number(x.amount) || 0;
        const d = flowOn(x);
        if (!d || d.getFullYear() < currentYear) { onBefore(v); return; }
        if (d.getFullYear() > currentYear) return;
        byMonth[d.getMonth()] += v;
        if (labels && x.label && !labels[d.getMonth()].includes(x.label)) labels[d.getMonth()].push(x.label);
      });
    };
    spread(exceptionalPaid, paidByMonth, v => { paidBefore += v; }, paidLabels);
    spread(reimbursements, reimbByMonth, v => { reimbBefore += v; }, null);

    // Échéances armées (prélèvements à venir, provisions ET dépenses programmées) :
    // elles creusent le graphe PAR ANTICIPATION. Elles ne touchent ni realCash ni le
    // virement — l'argent ne sort qu'au jour J, où elles deviennent de vraies dépenses.
    const dueByMonth = Array(12).fill(0);
    const dueLabels = Array.from({ length: 12 }, () => []);
    annualExpenses.forEach(e => {
      dueList(e).forEach(x => {
        const d = new Date(x.date);
        if (isNaN(d) || d.getFullYear() !== currentYear) return;
        dueByMonth[d.getMonth()] += Number(x.amount) || 0;
        if (!dueLabels[d.getMonth()].includes(e.name)) dueLabels[d.getMonth()].push(e.name);
      });
    });

    let cumulReimb = 0, cumulOut = 0;
    const projection = Array.from({ length: 12 }, (_, i) => {
      cumulReimb += reimbByMonth[i];
      // Ce que le mois consomme : dépenses réellement payées + échéances encore armées.
      const consomme = paidByMonth[i] + dueByMonth[i];
      // Solde AVANT la consommation du mois = sommet de la barre empilée.
      const avant = Math.round(
        startCash + accProvisionAt(absMonth(currentYear, i))
        + reimbBefore + cumulReimb
        - paidBefore - cumulOut
        - totalPending
      );
      cumulOut += consomme;
      return {
        name: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'][i],
        // Barre verte = ce qui reste APRÈS ; segment rouge empilé = la part consommée.
        solde: avant - Math.round(consomme),
        due: Math.round(consomme),
        dueLabel: [...paidLabels[i], ...dueLabels[i]].join(' · ')
      };
    });

    return { virement, realCash, projection, provision, totalFixed, totalAnnual, totalPending };
  }, [fixedExpenses, annualExpenses, reimbursements, exceptionalPaid, pending]);

  // --- 4. LOGIQUES INDÉPENDANTES ---
  // Prix d'une ligne de fonds : VL live si dispo, sinon dernière VL en cache.
  const fundPrice = (h) => (vlMap[h.fundId]?.vl ?? h.lastVL ?? 0);
  // Valeur d'un compte : portefeuille = Σ(parts × VL) arrondi à l'euro ; sinon solde saisi.
  const accountValue = (acc) => acc.isPortfolio
    ? Math.round((acc.holdings || []).reduce((s, h) => s + (Number(h.shares) || 0) * fundPrice(h), 0) + (Number(acc.cash) || 0))
    : (Number(acc.balance) || 0);

  // Seuls le PEA et un compte-titres peuvent détenir des parts (détection par le
  // nom). Les autres comptes sont monétaires : leur crayon sert juste à renommer.
  const canHoldTitles = (acc) => acc.isPortfolio || /pea|titre/i.test(acc.name || '');

  const savingsTotal = useMemo(() => {
    return savingsAccounts.filter(isMoneyAccount).reduce((sum, acc) => {
      if (acc.isPortfolio) {
        const v = (acc.holdings || []).reduce((s, h) => s + (Number(h.shares) || 0) * (vlMap[h.fundId]?.vl ?? h.lastVL ?? 0), 0) + (Number(acc.cash) || 0);
        return sum + Math.round(v);
      }
      return sum + (Number(acc.balance) || 0);
    }, 0);
  }, [savingsAccounts, vlMap]);

  // Symboles des fonds détenus (pour savoir quelles VL rafraîchir).
  const portfolioSymbols = useMemo(() => {
    const s = new Set();
    savingsAccounts.forEach(a => { if (a.isPortfolio) (a.holdings || []).forEach(h => s.add(h.fundId)); });
    return Array.from(s);
  }, [savingsAccounts]);

  // Récupère les VL via la fonction serverless /api/vl (same-origin, sans CORS).
  const fetchVLs = async (symbols) => {
    const list = symbols && symbols.length ? symbols : portfolioSymbols;
    if (!list.length) return;
    setVlLoading(true);
    try {
      const results = await Promise.all(list.map(async (sym) => {
        try {
          const r = await fetch(`/api/vl?symbol=${encodeURIComponent(sym)}`);
          if (!r.ok) return null;
          const j = await r.json();
          return (typeof j.vl === 'number' && isFinite(j.vl)) ? { sym, vl: j.vl } : null;
        } catch { return null; }
      }));
      const now = Date.now();
      const updates = {};
      results.forEach(res => { if (res) updates[res.sym] = { vl: res.vl, at: now }; });
      if (Object.keys(updates).length) {
        setVlMap(prev => ({ ...prev, ...updates }));
        // Cache la dernière VL dans les lignes (reste lisible hors-ligne / si échec futur).
        setSavingsAccounts(prev => prev.map(a => a.isPortfolio ? {
          ...a,
          holdings: (a.holdings || []).map(h => updates[h.fundId]
            ? { ...h, lastVL: updates[h.fundId].vl, vlAt: now } : h)
        } : a));
      }
    } finally {
      setVlLoading(false);
    }
  };

  // Rafraîchit les VL au chargement et quand la liste des fonds détenus change.
  useEffect(() => {
    if (loading || !session) return;
    if (portfolioSymbols.length) fetchVLs(portfolioSymbols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioSymbols.join(','), loading]);

  const openPortfolio = (acc) => {
    const draft = {};
    BOURSO_FUNDS.forEach(f => {
      const h = (acc.holdings || []).find(x => x.fundId === f.id);
      draft[f.id] = h ? String(h.shares) : '';
    });
    // Compte simple : son solde est repris comme liquidités (rien ne disparaît
    // quand on ajoute des titres à un compte qui n'était pas encore portefeuille).
    const cashInit = acc.isPortfolio ? acc.cash : (acc.cash ?? acc.balance);
    draft._cash = (cashInit != null && cashInit !== 0) ? String(cashInit) : '';
    setPortfolioDraft(draft);
    setModal({ open: true, type: 'portfolio', data: acc });
    fetchVLs(BOURSO_FUNDS.map(f => f.id)); // VL fraîches pour l'aperçu
  };

  const handlePortfolioSave = () => {
    const acc = modal.data;
    const holdings = BOURSO_FUNDS.map(f => {
      const shares = parseFloat(String(portfolioDraft[f.id] ?? '').replace(',', '.'));
      const existing = (acc.holdings || []).find(h => h.fundId === f.id);
      return {
        fundId: f.id,
        shares: isFinite(shares) ? shares : 0,
        lastVL: existing?.lastVL ?? vlMap[f.id]?.vl ?? null,
        vlAt: existing?.vlAt ?? vlMap[f.id]?.at ?? null,
      };
    }).filter(h => h.shares > 0);
    const cash = parseFloat(String(portfolioDraft._cash ?? '').replace(',', '.'));
    const safeCash = isFinite(cash) ? cash : 0;
    // Sans aucune part : le compte (re)devient un compte simple dont le solde = liquidités.
    setSavingsAccounts(savingsAccounts.map(a => a.id === acc.id
      ? (holdings.length
        ? { ...a, isPortfolio: true, holdings, cash: safeCash }
        : { id: a.id, name: a.name, balance: safeCash })
      : a));
    setModal({ open: false, type: '', data: null });
    setPortfolioDraft({});
    const syms = holdings.map(h => h.fundId);
    if (syms.length) fetchVLs(syms);
  };

  // --- CRYPTO (stocké dans savings_accounts avec kind:'crypto', affiché sur sa propre page) ---
  const cryptoAssets = savingsAccounts.filter(a => a.kind === 'crypto');
  // Liste affichée sur la page Épargne : comptes + la ligne Crypto (sentinelle) à la
  // position du bloc crypto dans savingsAccounts. Réordonner déplace le bloc entier.
  const savingsDisplay = [];
  savingsAccounts.forEach(a => {
    if (a.kind === 'crypto') {
      if (!savingsDisplay.includes(CRYPTO_ROW)) savingsDisplay.push(CRYPTO_ROW);
    } else if (!isRealEstate(a)) savingsDisplay.push(a);
  });
  // Le bien immobilier (page Immobilier) n'est pas dans la liste : on le réinjecte pour ne pas le perdre.
  const reorderSavings = (newList) => setSavingsAccounts([
    ...newList.flatMap(item => (item === CRYPTO_ROW ? cryptoAssets : [item])),
    ...savingsAccounts.filter(isRealEstate),
  ]);
  // Réordonner les cryptos (page Crypto) sans toucher à la position du bloc dans l'épargne.
  const reorderCryptos = (newList) => {
    let i = 0;
    setSavingsAccounts(prev => prev.map(a => (a.kind === 'crypto' ? newList[i++] : a)));
  };
  const cryptoSymbolsKey = cryptoAssets.map(a => a.sym).join(',');
  const cryptoPrice = (a) => (cryptoPrices[a.sym]?.price ?? a.lastPrice ?? 0);
  const cryptoValue = (a) => Math.round((Number(a.qty) || 0) * cryptoPrice(a));
  const cryptoTotal = cryptoAssets.reduce((s, a) => s + cryptoValue(a), 0);

  const fetchCryptoPrices = async (symbols) => {
    const list = [...new Set(symbols && symbols.length ? symbols : cryptoAssets.map(a => a.sym))];
    if (!list.length) return;
    setCryptoLoading(true);
    try {
      const r = await fetch(`/api/crypto?symbols=${encodeURIComponent(list.join(','))}`);
      if (r.ok) {
        const j = await r.json();
        const now = Date.now();
        const updates = {};
        Object.entries(j.prices || {}).forEach(([sym, p]) => {
          const n = Number(p);
          if (isFinite(n)) updates[sym] = { price: n, at: now };
        });
        if (Object.keys(updates).length) {
          setCryptoPrices(prev => ({ ...prev, ...updates }));
          setSavingsAccounts(prev => prev.map(a => (a.kind === 'crypto' && updates[a.sym])
            ? { ...a, lastPrice: updates[a.sym].price, priceAt: now } : a));
        }
      }
    } finally {
      setCryptoLoading(false);
    }
  };

  // Rafraîchit les cours au chargement et quand la liste des cryptos détenues change.
  useEffect(() => {
    if (loading || !session) return;
    if (cryptoAssets.length) fetchCryptoPrices(cryptoAssets.map(a => a.sym));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cryptoSymbolsKey, loading]);

  const openAddCrypto = () => {
    const held = new Set(cryptoAssets.map(a => a.sym));
    const first = CRYPTOS.find(c => !held.has(c.sym));
    setCryptoDraft({ sym: first ? first.sym : '', qty: '' });
    setModal({ open: true, type: 'add_crypto', data: null });
    fetchCryptoPrices(CRYPTOS.map(c => c.sym));
  };

  const openEditCrypto = (a) => {
    setCryptoDraft({ sym: a.sym, qty: String(a.qty) });
    setModal({ open: true, type: 'edit_crypto', data: a });
    fetchCryptoPrices([a.sym]);
  };

  const handleCryptoSave = () => {
    const qty = parseFloat(String(cryptoDraft.qty ?? '').replace(',', '.'));
    if (!cryptoDraft.sym || !isFinite(qty) || qty <= 0) return;
    const existing = cryptoAssets.find(a => a.sym === cryptoDraft.sym);
    if (modal.type === 'edit_crypto') {
      setSavingsAccounts(savingsAccounts.map(x => x.id === modal.data.id ? { ...x, qty } : x));
    } else if (existing) {
      setSavingsAccounts(savingsAccounts.map(x => x.id === existing.id ? { ...x, qty } : x));
    } else {
      setSavingsAccounts([...savingsAccounts, {
        id: Date.now(), kind: 'crypto', sym: cryptoDraft.sym, qty,
        lastPrice: cryptoPrices[cryptoDraft.sym]?.price ?? null,
        priceAt: cryptoPrices[cryptoDraft.sym]?.at ?? null,
      }]);
    }
    setModal({ open: false, type: '', data: null });
    setCryptoDraft({});
    fetchCryptoPrices([cryptoDraft.sym]);
  };

  // --- IMMOBILIER (stocké dans savings_accounts avec kind:'realestate', page dédiée) ---
  // Un seul bien ; tout est dérivé au rendu depuis les paramètres du prêt (cf. src/realestate.js).
  const realEstate = savingsAccounts.find(isRealEstate) || null;
  const reStats = useMemo(() => (realEstate ? realEstateStats(realEstate, undefined, reGrowth) : null), [realEstate, reGrowth]);
  const openRealEstate = () => {
    const src = realEstate || REALESTATE_DEFAULTS;
    const loan = { ...REALESTATE_DEFAULTS.loan, ...(src.loan || {}) };
    setForm({
      label: src.name || '', amount: String(src.value ?? ''), apport: String(src.apport ?? ''),
      releaseFees: String(src.releaseFees ?? REALESTATE_DEFAULTS.releaseFees),
      principal: String(loan.principal), rate: String(loan.rate), payment: String(loan.payment),
      insurance: String(loan.insurance), deferred: String(loan.deferred), months: String(loan.months),
      iraFreeAfter: String(loan.iraFreeAfter ?? ''),
      firstDue: loan.firstDue || '', cat: 'fixed', targetAccount: '', startDate: '',
    });
    setModal({ open: true, type: 'realestate', data: realEstate });
  };
  const handleRealEstateSave = () => {
    const num = (k) => parseFloat(String(form[k] ?? '').replace(',', '.'));
    const value = num('amount'), principal = num('principal'), payment = num('payment'), months = Math.floor(num('months'));
    if (!(value > 0) || !(principal > 0) || !(payment > 0) || !(months > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(form.firstDue || '')) return;
    const item = {
      id: realEstate?.id ?? Date.now(), kind: 'realestate', name: (form.label || '').trim() || 'Bien immobilier',
      value, apport: num('apport') || 0, releaseFees: num('releaseFees') || 0,
      loan: {
        principal, rate: num('rate') || 0, payment, insurance: num('insurance') || 0,
        deferred: Math.max(0, Math.floor(num('deferred') || 0)), months, firstDue: form.firstDue,
        iraFreeAfter: Math.max(0, Math.floor(num('iraFreeAfter') || 0)),
      },
    };
    setSavingsAccounts(realEstate ? savingsAccounts.map(a => (a.id === realEstate.id ? item : a)) : [...savingsAccounts, item]);
    setModal({ open: false, type: '', data: null });
    setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '', startDate: '' });
  };
  const fmtDate = (d) => (d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  const fmtDuration = (n) => {
    const y = Math.floor(n / 12), m = n % 12;
    return [y ? `${y} an${y > 1 ? 's' : ''}` : '', m ? `${m} mois` : ''].filter(Boolean).join(' ') || '0 mois';
  };

  // Vraies provisions annuelles (onglet Charges communes), hors dépenses programmées.
  const provisionItems = useMemo(() => annualExpenses.filter(e => !e.noProvision), [annualExpenses]);

  // Dépenses programmées (factures datées hors prévisionnel), affichées sur le dashboard.
  const scheduledExpenses = useMemo(
    () => annualExpenses.filter(e => e.noProvision && dueList(e).length > 0),
    [annualExpenses]
  );

  const personalTotal = useMemo(() => {
    return personalExpenses.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
  }, [personalExpenses]);

  const savingsPendingTotal = useMemo(() => {
    return savingsPending.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
  }, [savingsPending]);

  const handleSavingsTransaction = (isIncome) => {
    const val = parseFloat(form.amount);
    if (!form.targetAccount || isNaN(val)) return;

    setSavingsAccounts(savingsAccounts.map(acc => {
      if (acc.id === form.targetAccount) {
        return { ...acc, balance: isIncome ? acc.balance + val : acc.balance - val };
      }
      return acc;
    }));
    setModal({ open: false, type: '', data: null });
    setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '', startDate: '' });
  };

  const handleSavingsAdvance = () => {
    const val = parseFloat(form.amount);
    if (isNaN(val) || val <= 0) return;
    // Cumul sur une avance existante : le compte cible est déjà porté par l'avance,
    // on ne redemande donc ni le libellé ni le compte.
    const existing = form.targetPending ? savingsPending.find(p => p.id === form.targetPending) : null;
    const sharedId = Date.now();
    if (existing) {
      setSavingsPending(savingsPending.map(p => p.id === existing.id ? { ...p, amount: p.amount + val } : p));
      setSavingsAccounts(savingsAccounts.map(acc => acc.id === existing.targetAccountId ? { ...acc, balance: acc.balance - val } : acc));
      addEntry(sharedId, `Ajout avance Épargne: ${existing.label}`, val, 'advance');
    } else {
      if (!form.targetAccount || !form.label) return;
      setSavingsPending([...savingsPending, { id: sharedId, label: form.label, amount: val, targetAccountId: form.targetAccount }]);
      setSavingsAccounts(savingsAccounts.map(acc => acc.id === form.targetAccount ? { ...acc, balance: acc.balance - val } : acc));
      addEntry(sharedId, `Avance Épargne: ${form.label}`, val, 'advance');
    }
    setModal({ open: false, type: '', data: null });
    setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '', startDate: '' });
  };

  // Retire toutes les échéances d'une provision (la provision elle-même est conservée).
  const clearDueDate = (id) => {
    setAnnualExpenses(annualExpenses.map(x => x.id === id ? { ...x, dueSchedule: [], dueDate: null, dueAmount: null } : x));
    setModal({ open: false, type: '', data: null });
    setDueDraft([]);
  };

  // Lignes valides du brouillon d'échéances, triées (incomplètes ignorées).
  const cleanDueDraft = () => dueDraft
    .map(d => ({ id: d.id, date: d.date, amount: parseFloat(String(d.amount).replace(',', '.')) }))
    .filter(d => d.date && !isNaN(d.amount) && d.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Dépense programmée depuis le dashboard : une facture connue d'avance, hors
  // prévisionnel. Rangée dans `annualExpenses` avec `noProvision` — elle réutilise
  // toute la mécanique des échéances (jour J, graphe) sans alimenter la provision.
  const handleScheduledSave = () => {
    const sched = cleanDueDraft();
    const name = (form.label || '').trim();
    if (!sched.length || !name) return;
    const total = Math.round(sched.reduce((a, d) => a + d.amount, 0));
    const editing = modal.data;
    if (editing) {
      setAnnualExpenses(annualExpenses.map(x => x.id === editing.id
        ? { ...x, name, amount: total, dueSchedule: sched } : x));
    } else {
      setAnnualExpenses([...annualExpenses, {
        id: Date.now(), name, amount: total, startDate: null, noProvision: true, dueSchedule: sched
      }]);
    }
    setModal({ open: false, type: '', data: null });
    setDueDraft([]);
    setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '', startDate: '' });
  };

  // Enregistre la liste d'échéances saisie dans la modale.
  const handleDueSave = () => {
    const clean = cleanDueDraft();
    setAnnualExpenses(annualExpenses.map(x => x.id === modal.data.id
      ? { ...x, dueSchedule: clean, dueDate: null, dueAmount: null }
      : x));
    setModal({ open: false, type: '', data: null });
    setDueDraft([]);
  };

  const togglePersonalPaid = (id) => {
    setPersonalExpenses(personalExpenses.map(p => p.id === id ? { ...p, isPaid: !p.isPaid } : p));
  };

  const updatePersonalComment = (id, comment) => {
    setPersonalExpenses(personalExpenses.map(p => p.id === id ? { ...p, comment } : p));
  };

  // --- HELPER LOG ---
  const addEntry = (id, label, amount, type) => {
    const newLog = {
      id: id, label, amount, type,
      date: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
    };
    setHistory([newLog, ...history]);
  };

  const getIcon = (name) => {
    const n = (name || '').toLowerCase();
    if (n.includes('crédit') || n.includes('immo')) return <Home size={18} />;
    if (n.includes('charges') || n.includes('engie') || n.includes('eau')) return <Zap size={18} />;
    if (n.includes('crèche') || n.includes('santé')) return <HeartPulse size={18} />;
    return <Receipt size={18} />;
  };

  // --- GESTION FORMULAIRES ---
  const handleAbsorb = () => {
    const debt = modal.data;
    const sharedId = Date.now();

    if (modal.type === 'repay_savings_advance') {
      setSavingsPending(savingsPending.filter(p => p.id !== debt.id));
      addEntry(sharedId, `Absorbé Épargne: ${debt.label}`, debt.amount, 'payment');
    } else {
      setPending(pending.filter(p => p.id !== debt.id));
      setExceptionalPaid([...exceptionalPaid, { id: sharedId, label: debt.label, amount: debt.amount, paidOn: todayISO() }]);
      addEntry(sharedId, `Absorbé: ${debt.label}`, debt.amount, 'payment');
    }

    setModal({ open: false, type: '', data: null });
    setForm({ label: '', amount: '', cat: 'fixed' });
  };

  const handleDeleteHistory = (item) => {
    if (!window.confirm("Supprimer cette écriture et mettre à jour le solde ?")) return;
    setHistory(history.filter(h => h.id !== item.id));
    if (item.type === 'payment') setExceptionalPaid(exceptionalPaid.filter(p => p.id !== item.id));
    else if (item.type === 'reimb') setReimbursements(reimbursements.filter(r => r.id !== item.id));
  };

  const handleEditHistory = (item) => {
    setForm({ label: item.label, amount: item.amount, cat: 'fixed' });
    setModal({ open: true, type: 'edit_history', data: item });
  };

  const handleArchiveHistory = (item) => {
    setHistory(history.map(h => h.id === item.id ? { ...h, isArchived: !h.isArchived } : h));
  };

  const handleForm = (e) => {
    e.preventDefault();
    // Modales à bouton dédié : la validation clavier (Entrée / « OK » mobile)
    // doit enregistrer au lieu d'être ignorée (form.amount y est vide).
    if (modal.type === 'portfolio') { handlePortfolioSave(); return; }
    if (modal.type === 'add_crypto' || modal.type === 'edit_crypto') { handleCryptoSave(); return; }
    if (modal.type === 'realestate') { handleRealEstateSave(); return; }
    if (modal.type === 'due_date') { handleDueSave(); return; }
    // Dépense du dashboard avec des échéances saisies → dépense PROGRAMMÉE : rien ne
    // sort avant le jour J, donc pas de montant global à valider ici.
    if (modal.type === 'exceptional' && cleanDueDraft().length) { handleScheduledSave(); return; }
    if (modal.type === 'rename_savings') {
      const name = (form.label || '').trim();
      if (name) setSavingsAccounts(savingsAccounts.map(a => a.id === modal.data.id ? { ...a, name } : a));
      setModal({ open: false, type: '', data: null });
      setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '', startDate: '' });
      return;
    }
    const val = parseFloat(form.amount);
    if (isNaN(val) || val <= 0) return;
    const sharedId = Date.now();

    if (modal.type === 'create_savings_account') {
      setSavingsAccounts([...savingsAccounts, { id: Date.now().toString(), name: form.label, balance: val }]);
    }
    else if (modal.type === 'create_personal_expense') {
      const editing = modal.data;
      if (editing) {
        setPersonalExpenses(personalExpenses.map(p => p.id === editing.id ? { ...p, label: form.label, amount: val } : p));
      } else {
        setPersonalExpenses([...personalExpenses, { id: Date.now(), label: form.label, amount: val, isPaid: false, comment: '' }]);
      }
    }
    else if (modal.type === 'edit_history') {
      const oldItem = modal.data;
      setHistory(history.map(h => h.id === oldItem.id ? { ...h, label: form.label, amount: val } : h));
      if (oldItem.type === 'payment') setExceptionalPaid(exceptionalPaid.map(p => p.id === oldItem.id ? { ...p, label: form.label, amount: val } : p));
      else if (oldItem.type === 'reimb') setReimbursements(reimbursements.map(r => r.id === oldItem.id ? { ...r, label: form.label, amount: val } : r));
    }
    else if (modal.type === 'pending') {
      // Avance existante sélectionnée → on cumule le montant, sinon nouvelle ligne.
      const existing = form.targetPending ? pending.find(p => p.id === form.targetPending) : null;
      if (existing) {
        setPending(pending.map(p => p.id === existing.id ? { ...p, amount: p.amount + val } : p));
        addEntry(sharedId, `Ajout avance: ${existing.label}`, val, 'advance');
      } else {
        setPending([{ id: sharedId, label: form.label, amount: val }, ...pending]);
        addEntry(sharedId, `Avance: ${form.label}`, val, 'advance');
      }
    }
    else if (modal.type === 'exceptional') {
      setExceptionalPaid([{ id: sharedId, label: form.label, amount: val, paidOn: todayISO() }, ...exceptionalPaid]);
      addEntry(sharedId, form.label, val, 'payment');
    }
    else if (modal.type === 'reimbursement') {
      setReimbursements([{ id: sharedId, label: form.label, amount: val, paidOn: todayISO() }, ...reimbursements]);
      addEntry(sharedId, form.label, val, 'reimb');
    }
    else if (modal.type === 'expense') {
      const editing = modal.data;
      const nowFixed = form.cat === 'fixed';
      const item = nowFixed
        ? { id: editing ? editing.id : sharedId, name: form.label, amount: val }
        : { id: editing ? editing.id : sharedId, name: form.label, amount: val, startDate: form.startDate || null };
      if (editing) {
        const wasFixed = fixedExpenses.some(x => x.id === editing.id);
        if (wasFixed === nowFixed) {
          if (nowFixed) setFixedExpenses(fixedExpenses.map(x => x.id === editing.id ? item : x));
          else setAnnualExpenses(annualExpenses.map(x => x.id === editing.id ? item : x));
        } else if (wasFixed) {
          setFixedExpenses(fixedExpenses.filter(x => x.id !== editing.id));
          setAnnualExpenses([...annualExpenses, item]);
        } else {
          setAnnualExpenses(annualExpenses.filter(x => x.id !== editing.id));
          setFixedExpenses([...fixedExpenses, item]);
        }
      } else if (nowFixed) {
        setFixedExpenses([...fixedExpenses, item]);
      } else {
        setAnnualExpenses([...annualExpenses, item]);
      }
    }
    else if (modal.type === 'repay_partial') {
      const debt = modal.data;
      if (val >= debt.amount) {
        setPending(pending.filter(p => p.id !== debt.id));
        addEntry(sharedId, `Remboursé: ${debt.label}`, debt.amount, 'reimb');
      } else {
        setPending(pending.map(p => p.id === debt.id ? { ...p, amount: p.amount - val } : p));
        addEntry(sharedId, `Partiel: ${debt.label}`, val, 'reimb');
      }
    }
    else if (modal.type === 'repay_savings_advance') {
      const debt = modal.data;
      if (val >= debt.amount) {
        setSavingsPending(savingsPending.filter(p => p.id !== debt.id));
        setSavingsAccounts(savingsAccounts.map(acc => {
          if (acc.id === debt.targetAccountId) return { ...acc, balance: acc.balance + debt.amount };
          return acc;
        }));
        addEntry(sharedId, `Remboursé Épargne: ${debt.label}`, debt.amount, 'reimb');
      } else {
        setSavingsPending(savingsPending.map(p => p.id === debt.id ? { ...p, amount: p.amount - val } : p));
        setSavingsAccounts(savingsAccounts.map(acc => {
          if (acc.id === debt.targetAccountId) return { ...acc, balance: acc.balance + val };
          return acc;
        }));
        addEntry(sharedId, `Partiel Épargne: ${debt.label}`, val, 'reimb');
      }
    }
    setModal({ open: false, type: '', data: null });
    setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '', startDate: '' });
  };

  // --- RENDER ---
  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-emerald-500"><Loader2 className="animate-spin" size={48} /></div>;

  if (!session) return (
    <div className="min-h-screen bg-[#020202] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <p className="text-zinc-500 text-xs font-bold uppercase tracking-[0.3em]">Cloud Access</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/10 rounded-[2.5rem] p-8 space-y-6 backdrop-blur-xl">
          <div className="flex gap-2 bg-black/50 p-1 rounded-2xl">
            <button onClick={() => setAuthMode('login')} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${authMode === 'login' ? 'bg-emerald-600 text-white' : 'text-zinc-600'}`}>Connexion</button>
            <button onClick={() => setAuthMode('signup')} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${authMode === 'signup' ? 'bg-emerald-600 text-white' : 'text-zinc-600'}`}>Créer</button>
          </div>
          {authError && <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl text-red-400 text-xs font-bold text-center">{authError}</div>}
          <form onSubmit={handleAuth} className="space-y-4">
            <input type="email" required placeholder="Email" className="w-full bg-black/50 border border-white/10 rounded-2xl p-5 outline-none focus:border-emerald-500 font-bold transition-all text-white" value={email} onChange={e => setEmail(e.target.value)} />
            <input type="password" required placeholder="Mot de passe" className="w-full bg-black/50 border border-white/10 rounded-2xl p-5 outline-none focus:border-emerald-500 font-bold transition-all text-white" value={password} onChange={e => setPassword(e.target.value)} />
            <button type="submit" className="w-full bg-white text-black py-5 rounded-[2rem] font-black text-lg uppercase hover:scale-[1.02] transition-all">
              {authMode === 'login' ? 'Entrer' : 'S\'inscrire'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="min-h-screen bg-[#020202] text-white font-sans antialiased pb-32 px-6 pt-6 selection:bg-emerald-500/30 overflow-x-hidden select-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="max-w-md mx-auto space-y-6">

        {saveError && (
          <div className="bg-red-500/15 border border-red-500/30 text-red-400 text-[11px] font-bold rounded-2xl px-4 py-3 text-center leading-tight">
            ⚠ Échec de sauvegarde — vérifie ta connexion. Tes dernières modifications ne sont peut-être pas enregistrées.
          </div>
        )}

        {/* HEADER REMOVED REPLACEMENT LOGIC */}


        {activeTab === 'dashboard' && (
          <div className="space-y-10 page-transition">
            {/* CARTE CASH DISPO */}
            <div className="bg-zinc-900/40 border border-white/10 rounded-[2.5rem] p-6 relative overflow-hidden backdrop-blur-xl shadow-2xl neon-pulse">
              <div className="absolute -top-24 -right-24 w-64 h-64 bg-emerald-600/10 blur-[100px]" />
              <div className="flex justify-between items-start mb-4 relative z-10">
                <div>
                  <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest italic mb-1">Cash Dispo</p>
                  <h2 className="text-5xl font-black tracking-tighter italic">{totals.realCash.toLocaleString()}€</h2>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-2 text-right shadow-lg shadow-amber-500/5">
                  <p className="text-amber-500 text-[9px] font-black uppercase tracking-widest italic leading-none mb-1.5">Avances</p>
                  <p className="text-xl font-black italic text-amber-400 leading-none">{totals.totalPending.toLocaleString()}€</p>
                </div>
              </div>
            </div>
            <div className="h-44 w-full relative z-10">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={totals.projection}>
                  <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.55} /><stop offset="95%" stopColor="#10b981" stopOpacity={0.10} /></linearGradient>
                    <linearGradient id="gNow" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#34d399" stopOpacity={1} /><stop offset="95%" stopColor="#2dd4bf" stopOpacity={0.45} /></linearGradient>
                    <linearGradient id="gNeg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f87171" stopOpacity={0.8} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0.25} /></linearGradient>
                    <linearGradient id="gDue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#fb7185" stopOpacity={1} /><stop offset="95%" stopColor="#e11d48" stopOpacity={0.75} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                  <XAxis dataKey="name" stroke="#3f3f46" fontSize={10} tickLine={false} axisLine={false} interval={0} padding={{ left: 10, right: 10 }}
                    tick={({ x, y, payload, index }) => (
                      <text x={x} y={y + 10} textAnchor="middle" fontSize={10} fontWeight={index === new Date().getMonth() ? 900 : 500} fill={index === new Date().getMonth() ? '#34d399' : '#3f3f46'}>{payload.value}</text>
                    )} />
                  <Tooltip content={<ProjectionTooltip />} cursor={{ fill: '#ffffff05' }} />
                  <Bar dataKey="solde" stackId="p" radius={[6, 6, 0, 0]}>
                    {totals.projection.map((d, i) => (
                      <Cell key={d.name} fill={d.solde < 0 ? 'url(#gNeg)' : i === new Date().getMonth() ? 'url(#gNow)' : 'url(#g)'} />
                    ))}
                  </Bar>
                  {/* Échéance datée : segment rouge empilé au-dessus du solde restant. */}
                  <Bar dataKey="due" stackId="p" radius={[6, 6, 0, 0]} fill="url(#gDue)" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* QUICK ACTIONS */}
            <div className="grid grid-cols-3 gap-4">
              <button onClick={() => { setDueDraft([]); setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '', startDate: '' }); setModal({ open: true, type: 'exceptional', data: null }); }} className="bg-zinc-900/50 border border-white/5 p-5 rounded-[2rem] flex flex-col items-center transition-all">
                <ArrowUpRight size={22} className="mb-2 text-red-500" /><span className="text-[8px] font-black uppercase text-red-400 text-center tracking-tighter leading-tight">Dépenses</span>
              </button>
              <button onClick={() => setModal({ open: true, type: 'reimbursement' })} className="bg-emerald-500/10 border border-emerald-500/20 p-5 rounded-[2rem] flex flex-col items-center transition-all">
                <ArrowDownLeft size={22} className="mb-2 text-emerald-500" /><span className="text-[8px] font-black uppercase text-emerald-400 text-center tracking-tighter leading-tight text-emerald-400">Recette</span>
              </button>
              <button onClick={() => { setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '', startDate: '', targetPending: '' }); setModal({ open: true, type: 'pending' }); }} className="bg-white text-black p-5 rounded-[2rem] flex flex-col items-center transition-all">
                <Plus size={22} className="mb-2" /><span className="text-[8px] font-black uppercase text-center tracking-tighter leading-tight">Avance</span>
              </button>
            </div>

            {/* PRÉLÈVEMENTS PROGRAMMÉS */}
            {scheduledExpenses.length > 0 && (
              <section className="space-y-4">
                <div className="flex justify-between px-4 items-end">
                  <p className="text-[10px] font-black text-rose-400 uppercase tracking-[0.4em] italic leading-none">Prélèvements à venir</p>
                  <p className="text-xl font-black italic text-rose-400 leading-none">
                    {scheduledExpenses.reduce((a, e) => a + dueTotal(e), 0).toLocaleString()}€
                  </p>
                </div>
                <div className="space-y-2">
                  {scheduledExpenses.map(e => (
                    <div key={e.id} className="bg-zinc-900/30 border border-white/5 p-4 rounded-[2.8rem] flex justify-between items-center relative overflow-hidden">
                      <div className="absolute left-2 top-5 bottom-5 w-1 rounded-full bg-rose-500" />
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-10 h-10 shrink-0 bg-rose-500/10 rounded-xl flex items-center justify-center text-rose-400"><CalendarClock size={18} /></div>
                        <div className="min-w-0">
                          <p className="text-sm font-black italic uppercase text-left truncate">{e.name}</p>
                          <p className="text-[8px] text-rose-400/80 font-black uppercase tracking-widest text-left">
                            {dueList(e).length > 1
                              ? `${dueList(e).length} prélèvements · dès ${new Date(dueList(e)[0].date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`
                              : `Le ${new Date(dueList(e)[0].date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end shrink-0 pl-2">
                        <span className="text-xl font-black italic text-rose-400">{Math.round(dueTotal(e)).toLocaleString()}€</span>
                        <div className="flex gap-2">
                          <button onClick={() => { setForm({ label: e.name, amount: '', cat: 'fixed', targetAccount: '', startDate: '' }); setDueDraft(dueList(e).map((d, i) => ({ id: d.id ?? Date.now() + i, date: d.date, amount: String(d.amount ?? '') }))); setModal({ open: true, type: 'exceptional', data: e }); }} className="text-zinc-600 hover:text-white"><Pencil size={14} /></button>
                          <button onClick={() => setAnnualExpenses(annualExpenses.filter(x => x.id !== e.id))} className="text-zinc-600 hover:text-red-500"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-zinc-600 font-bold px-4 leading-tight">Rien n'est débité avant la date : le Cash Dispo ne bouge qu'au jour J. Le graphe, lui, anticipe déjà le creux.</p>
              </section>
            )}

            {/* FLUX */}
            <section className="space-y-5">
              <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.4em] px-4 italic flex justify-between">
                Flux
              </h3>
              <Reorder.Group axis="y" values={pending} onReorder={(newList) => setPending(newList)} className="space-y-4">
                {pending.length === 0 ? <p className="text-center text-zinc-700 italic text-[10px] py-4">Aucune avance active.</p> :
                  pending.map(p => (
                    <DraggableItem key={p.id} value={p}>
                      <button onClick={() => setModal({ open: true, type: 'repay_partial', data: p })} className="w-full bg-zinc-900/30 border border-white/5 p-6 rounded-[2.8rem] flex justify-between items-center transition-all group relative overflow-hidden active:scale-95">
                        <div className="absolute left-2 top-5 bottom-5 w-1 rounded-full bg-amber-500" />
                        <div className="flex items-center gap-5">
                          <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center text-amber-500"><Coins size={22} /></div>
                          <div><p className="text-sm font-black italic uppercase text-left">{p.label}</p><p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest text-left">Gérer l'avance</p></div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-mono font-black text-amber-500 text-2xl">{Number(p.amount).toLocaleString()}€</span>
                          <DragHandle />
                        </div>
                      </button>
                    </DraggableItem>
                  ))}
              </Reorder.Group>
            </section>
          </div>
        )}

        {/* --- PAGE EPARGNE (MODIFIÉE CYAN + CORRECTIONS TEXTE) --- */}
        {activeTab === 'savings' && (
          <div className="space-y-10 page-transition">
            {/* CARTE CYAN */}
            <div className="bg-gradient-to-br from-cyan-900/40 to-blue-600/10 border border-cyan-500/20 rounded-[3rem] p-9 relative overflow-hidden neon-pulse neon-pulse-cyan">
              <div className="flex justify-between items-center relative z-10">
                <div>
                  <p className="text-cyan-400 text-[10px] font-black uppercase tracking-widest italic mb-1">Épargne Totale</p>
                  <h2 className="text-5xl font-black tracking-tighter italic text-cyan-100">{(savingsTotal + cryptoTotal).toLocaleString()}€</h2>
                </div>
                <div className="w-14 h-14 bg-cyan-500 rounded-3xl flex items-center justify-center text-black shadow-lg shadow-cyan-500/20"><PiggyBank size={28} /></div>
              </div>
            </div>

            {/* ACTIONS */}
            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => setModal({ open: true, type: 'create_savings_account' })} className="bg-zinc-900 border border-white/10 py-4 rounded-2xl text-[10px] font-black uppercase text-zinc-400 hover:text-white transition-colors">Nouveau Compte</button>
              <button onClick={() => setModal({ open: true, type: 'savings_transaction' })} className="bg-zinc-900 border border-white/10 py-4 rounded-2xl text-[10px] font-black uppercase text-zinc-400 hover:text-emerald-400 transition-colors">Mouvement</button>
              <button onClick={() => { setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '', startDate: '', targetPending: '' }); setModal({ open: true, type: 'savings_advance' }); }} className="bg-zinc-900 border border-white/10 py-4 rounded-2xl text-[10px] font-black uppercase text-zinc-400 hover:text-amber-500 transition-colors">Créer Avance</button>
            </div>

            {/* LISTE COMPTES */}
            <Reorder.Group axis="y" values={savingsDisplay} onReorder={reorderSavings} className="space-y-4">
              {savingsDisplay.map(acc => acc === CRYPTO_ROW ? (
                /* Ligne Crypto : même thème que les comptes, réordonnable, mais lecture seule */
                <DraggableItem key="crypto-row" value={CRYPTO_ROW}>
                  <div onClick={() => setActiveTab('crypto')} className="bg-zinc-900/30 border border-white/5 p-4 rounded-[2.8rem] group active:scale-95 relative overflow-hidden cursor-pointer">
                    <div className="absolute left-2 top-5 bottom-5 w-1 rounded-full bg-cyan-500" />
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-cyan-500/10 rounded-xl flex items-center justify-center text-cyan-400"><Bitcoin size={20} /></div>
                        <div>
                          <p className="text-sm font-black italic uppercase text-left text-zinc-200">Crypto</p>
                          <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest text-left">Géré sur la page dédiée</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-xl font-black italic text-cyan-500">{cryptoTotal.toLocaleString()}€</span>
                        <DragHandle />
                      </div>
                    </div>
                  </div>
                </DraggableItem>
              ) : (
                <DraggableItem key={acc.id} value={acc}>
                  <div className="bg-zinc-900/30 border border-white/5 p-4 rounded-[2.8rem] group active:scale-95 relative overflow-hidden">
                    <div className="absolute left-2 top-5 bottom-5 w-1 rounded-full bg-cyan-500" />
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-cyan-500/10 rounded-xl flex items-center justify-center text-cyan-400">
                          {acc.isPortfolio ? <LineChart size={20} /> : <Wallet size={20} />}
                        </div>
                        <div>
                          <p className="text-sm font-black italic uppercase text-left text-zinc-200">{acc.name}</p>
                          <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest text-left">{acc.isPortfolio ? 'Portefeuille · parts' : 'Disponible'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col items-end">
                          <span className="text-xl font-black italic text-cyan-500">{accountValue(acc).toLocaleString()}€</span>
                          <div className="flex gap-2 items-center mt-0.5">
                            <button onClick={() => {
                              if (canHoldTitles(acc)) { openPortfolio(acc); }
                              else { setForm({ label: acc.name, amount: '', cat: 'fixed', targetAccount: '', startDate: '' }); setModal({ open: true, type: 'rename_savings', data: acc }); }
                            }} className="text-zinc-600 hover:text-cyan-400" title={canHoldTitles(acc) ? 'Gérer les parts' : 'Renommer le compte'}><Pencil size={13} /></button>
                            {acc.isPortfolio && <button onClick={() => fetchVLs(portfolioSymbols)} className="text-zinc-600 hover:text-white" title="Rafraîchir la VL"><RefreshCw size={12} className={vlLoading ? 'animate-spin' : ''} /></button>}
                            <button onClick={() => { if (window.confirm('Supprimer ce compte épargne ?')) setSavingsAccounts(savingsAccounts.filter(a => a.id !== acc.id)) }} className="text-zinc-700 hover:text-red-500"><Trash2 size={12} /></button>
                          </div>
                        </div>
                        <DragHandle />
                      </div>
                    </div>
                    {acc.isPortfolio && ((acc.holdings || []).length > 0 || (Number(acc.cash) || 0) > 0) && (
                      <div className="mt-3 pt-3 border-t border-white/5 space-y-1.5">
                        {(acc.holdings || []).map(h => (
                          <div key={h.fundId} className="flex justify-between items-center gap-2 text-[10px]">
                            <span className="font-bold text-zinc-400 uppercase truncate">{fundName(h.fundId)}</span>
                            <span className="font-mono text-zinc-500 whitespace-nowrap shrink-0">
                              {Number(h.shares).toLocaleString('fr-FR', { maximumFractionDigits: 4 })} × {fundPrice(h) ? fundPrice(h).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}€
                              <span className="text-cyan-500 font-black"> = {Math.round((Number(h.shares) || 0) * fundPrice(h)).toLocaleString()}€</span>
                            </span>
                          </div>
                        ))}
                        {(Number(acc.cash) || 0) > 0 && (
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="font-bold text-zinc-400 uppercase">Liquidités</span>
                            <span className="font-mono text-cyan-500 font-black">{Math.round(Number(acc.cash) || 0).toLocaleString()}€</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </DraggableItem>
              ))}
            </Reorder.Group>

            {/* ACTIF NET IMMOBILIER — volontairement hors liste et tout en bas : l'Épargne
                Totale ci-dessus reste la « vraie » épargne disponible sur les comptes. */}
            {realEstate && reStats && (
              <section className="space-y-4 pt-4 border-t border-white/5">
                <h3 className="text-[10px] font-black text-violet-700 uppercase tracking-widest px-2">Patrimoine immobilier</h3>
                <div onClick={() => setActiveTab('realestate')} className="bg-zinc-900/30 border border-white/5 p-4 rounded-[2.8rem] flex justify-between items-center cursor-pointer transition-all active:scale-95 relative overflow-hidden">
                  <div className="absolute left-2 top-5 bottom-5 w-1 rounded-full bg-violet-500" />
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-violet-500/10 rounded-xl flex items-center justify-center text-violet-400"><Building2 size={20} /></div>
                    <div>
                      <p className="text-sm font-black italic uppercase text-left text-zinc-200">Actif net immobilier</p>
                      <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest text-left">Net vendeur : valeur − restant dû − frais de vente</p>
                    </div>
                  </div>
                  <span className="text-xl font-black italic text-violet-300">{reStats.netAsset.toLocaleString()}€</span>
                </div>
                <div className="bg-violet-500/10 border border-violet-500/30 rounded-[2rem] p-5 flex justify-between items-center shadow-lg shadow-violet-500/5 neon-pulse neon-pulse-amethyst">
                  <div className="relative z-10">
                    <p className="text-violet-300 text-[10px] font-black uppercase tracking-widest italic">Patrimoine total</p>
                    <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest">Épargne + crypto + actif net immo</p>
                  </div>
                  <p className="text-2xl font-black italic text-violet-200 relative z-10">{(savingsTotal + cryptoTotal + reStats.netAsset).toLocaleString()}€</p>
                </div>
              </section>
            )}

            {/* AVANCE SUR EPARGNE (RENOMMÉ) */}
            {savingsPending.length > 0 && (
              <section className="space-y-4 pt-4 border-t border-white/5">
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-[2rem] p-5 flex justify-between items-center shadow-lg shadow-amber-500/5">
                  <p className="text-amber-500 text-[10px] font-black uppercase tracking-widest italic">Total Avances</p>
                  <p className="text-2xl font-black italic text-amber-400">{savingsPendingTotal.toLocaleString()}€</p>
                </div>
                <h3 className="text-[10px] font-black text-amber-700 uppercase tracking-widest px-2">Avance sur Épargne</h3>
                {savingsPending.map(p => {
                  const targetName = savingsAccounts.find(a => a.id === p.targetAccountId)?.name || 'Compte supprimé';
                  return (
                    <div key={p.id} onClick={() => { setForm({ amount: '' }); setModal({ open: true, type: 'repay_savings_advance', data: p }) }} className="bg-zinc-900/30 border border-white/5 p-4 rounded-[2.8rem] flex justify-between items-center cursor-pointer transition-all active:scale-95 relative overflow-hidden">
                      <div className="absolute left-2 top-5 bottom-5 w-1 rounded-full bg-amber-500" />
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center text-amber-500"><Coins size={20} /></div>
                        <div>
                          <p className="text-sm font-black italic uppercase text-left text-amber-500">{p.label}</p>
                          <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest text-left">Vers: {targetName}</p>
                        </div>
                      </div>
                      <span className="text-xl font-black italic text-amber-500">{Number(p.amount).toLocaleString()}€</span>
                    </div>
                  )
                })}
              </section>
            )}
          </div>
        )}

        {/* --- PAGE CRYPTO --- */}
        {activeTab === 'crypto' && (
          <div className="space-y-10 page-transition">
            {/* CARTE ORANGE BITCOIN */}
            <div className="bg-gradient-to-br from-orange-900/40 to-amber-600/10 border border-orange-500/20 rounded-[3rem] p-9 relative overflow-hidden neon-pulse neon-pulse-orange">
              <div className="flex justify-between items-center relative z-10">
                <div>
                  <p className="text-orange-400 text-[10px] font-black uppercase tracking-widest italic mb-1">Portefeuille Crypto</p>
                  <h2 className="text-5xl font-black tracking-tighter italic text-orange-100">{cryptoTotal.toLocaleString()}€</h2>
                </div>
                <div className="w-14 h-14 bg-orange-500 rounded-3xl flex items-center justify-center text-black shadow-lg shadow-orange-500/30"><Bitcoin size={28} strokeWidth={2.5} /></div>
              </div>
            </div>

            {/* ACTIONS */}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={openAddCrypto} className="bg-orange-500/10 border border-orange-500/30 py-4 rounded-2xl text-[10px] font-black uppercase text-orange-400 hover:text-orange-300 transition-colors flex items-center justify-center gap-2"><Plus size={16} /> Ajouter</button>
              <button onClick={() => fetchCryptoPrices(cryptoAssets.map(a => a.sym))} className="bg-zinc-900 border border-white/10 py-4 rounded-2xl text-[10px] font-black uppercase text-zinc-400 hover:text-white transition-colors flex items-center justify-center gap-2"><RefreshCw size={14} className={cryptoLoading ? 'animate-spin' : ''} /> MAJ cours</button>
            </div>

            {/* LISTE */}
            <Reorder.Group axis="y" values={cryptoAssets} onReorder={reorderCryptos} className="space-y-4">
              {cryptoAssets.length === 0 ? <p className="text-center text-zinc-700 italic text-[10px] py-4">Aucune crypto suivie. Ajoute-en une.</p> :
                cryptoAssets.map(a => (
                  <DraggableItem key={a.id} value={a}>
                    <div className="bg-zinc-900/30 border border-white/5 p-4 rounded-[2.8rem] flex justify-between items-center group active:scale-95 relative overflow-hidden">
                      <div className="absolute left-2 top-5 bottom-5 w-1 rounded-full bg-orange-500" />
                      <div className="flex items-center gap-4">
                        <div className="w-11 h-11 bg-orange-500/10 rounded-xl flex items-center justify-center text-orange-400 text-[10px] font-black">{a.sym}</div>
                        <div>
                          <p className="text-sm font-black italic uppercase text-left text-zinc-200">{cryptoName(a.sym)}</p>
                          <p className="text-[9px] text-zinc-500 font-mono text-left">{Number(a.qty).toLocaleString('fr-FR', { maximumFractionDigits: 8 })} × {cryptoPrice(a) ? cryptoPrice(a).toLocaleString('fr-FR', { maximumFractionDigits: cryptoPrice(a) < 1 ? 6 : 2 }) + '€' : '—'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col items-end">
                          <span className="text-xl font-black italic text-orange-500">{cryptoValue(a).toLocaleString()}€</span>
                          <div className="flex gap-2 mt-0.5">
                            <button onClick={() => openEditCrypto(a)} className="text-zinc-600 hover:text-orange-400"><Pencil size={13} /></button>
                            <button onClick={() => { if (window.confirm('Retirer cette crypto ?')) setSavingsAccounts(savingsAccounts.filter(x => x.id !== a.id)) }} className="text-zinc-700 hover:text-red-500"><Trash2 size={13} /></button>
                          </div>
                        </div>
                        <DragHandle />
                      </div>
                    </div>
                  </DraggableItem>
                ))}
            </Reorder.Group>
          </div>
        )}

        {/* --- PAGE IMMOBILIER (actif net = valeur du bien − capital restant dû) --- */}
        {activeTab === 'realestate' && (
          <div className="space-y-8 page-transition">
            {!realEstate || !reStats ? (
              <div className="bg-gradient-to-br from-violet-900/40 to-purple-600/10 border border-violet-500/20 rounded-[3rem] p-9 relative overflow-hidden neon-pulse neon-pulse-amethyst text-center space-y-5">
                <div className="w-14 h-14 mx-auto bg-violet-500 rounded-3xl flex items-center justify-center text-black shadow-lg shadow-violet-500/30"><Building2 size={28} strokeWidth={2.5} /></div>
                <p className="text-violet-300 text-[10px] font-black uppercase tracking-widest italic">Patrimoine immobilier</p>
                <p className="text-xs text-zinc-400 font-bold leading-relaxed">Renseigne la valeur du bien et les paramètres du crédit. L'actif net se recalcule ensuite tout seul à chaque prélèvement.</p>
                <button onClick={openRealEstate} className="w-full py-5 rounded-[2rem] bg-violet-600 font-black text-lg uppercase shadow-xl">Configurer</button>
              </div>
            ) : (
              <>
                {/* HÉRO ACTIF NET — l'engrenage ouvre les réglages du bien (modal `realestate`) */}
                <div className="bg-gradient-to-br from-violet-900/40 to-purple-600/10 border border-violet-500/20 rounded-[3rem] p-9 relative overflow-hidden neon-pulse neon-pulse-amethyst">
                  <button onClick={openRealEstate} aria-label="Réglages du bien" className="absolute top-4 right-5 z-20 w-8 h-8 rounded-full flex items-center justify-center text-violet-300/60 hover:text-violet-200 hover:bg-violet-500/10 transition-all active:scale-90"><Settings size={16} strokeWidth={2.5} /></button>
                  <div className="flex justify-between items-center relative z-10">
                    <div>
                      <p className="text-violet-300 text-[10px] font-black uppercase tracking-widest italic mb-1">Actif net immobilier</p>
                      <h2 className="text-5xl font-black tracking-tighter italic text-violet-100">{reStats.netAsset.toLocaleString()}€</h2>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mt-2">{Number(realEstate.value).toLocaleString()}€ − {Math.round(reStats.crd).toLocaleString()}€ restant dû − {Math.round(reStats.ira + reStats.releaseFees).toLocaleString()}€ frais de vente</p>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-violet-400/70 mt-1">À jour au {fmtDate(reStats.lastPaidDate)} · échéance {reStats.paid}/{reStats.schedule.length}</p>
                    </div>
                    <div className="w-14 h-14 shrink-0 bg-violet-500 rounded-3xl flex items-center justify-center text-black shadow-lg shadow-violet-500/30"><Building2 size={28} strokeWidth={2.5} /></div>
                  </div>
                </div>

                {/* PROGRESSION DU REMBOURSEMENT */}
                <div className="bg-zinc-900/30 border border-white/5 rounded-[2.5rem] p-6 space-y-3">
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Capital remboursé</p>
                      <p className="text-2xl font-black italic text-violet-300">{Math.round(reStats.capitalPaid).toLocaleString()}€<span className="text-xs text-zinc-500 ml-2">/ {Number(realEstate.loan.principal).toLocaleString()}€</span></p>
                    </div>
                    <p className="text-xl font-black italic text-white">{reStats.progress.toFixed(1)}%</p>
                  </div>
                  <div className="h-2.5 rounded-full bg-black/50 overflow-hidden border border-white/5">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-500 shadow-[0_0_12px_rgba(139,92,246,0.6)]" style={{ width: `${Math.min(100, Math.max(0, reStats.progress))}%` }} />
                  </div>
                </div>

                {/* ENRICHISSEMENT : ce que la prochaine mensualité met dans votre poche vs ce qu'elle coûte */}
                {reStats.next && (() => {
                  const tot = reStats.next.capital + reStats.next.interest + reStats.next.insurance;
                  const pct = tot > 0 ? (reStats.next.capital / tot) * 100 : 0;
                  return (
                    <div className="bg-zinc-900/30 border border-violet-500/20 rounded-[2.5rem] p-6 space-y-4">
                      <div className="flex justify-between items-start gap-4">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-violet-400">Vous vous enrichissez de</p>
                          <p className="text-3xl font-black italic text-violet-200 mt-1 leading-none">{Math.round(reStats.next.capital).toLocaleString()}€<span className="text-xs text-zinc-500 ml-1.5">/mois</span></p>
                          <p className="text-[9px] text-zinc-600 font-bold mt-1.5 leading-tight">capital remboursé, qui devient à vous</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 leading-none mb-1">Coût réel</p>
                          <p className="text-2xl font-black italic text-rose-400 leading-none">{Math.round(reStats.next.interest + reStats.next.insurance).toLocaleString()}€<span className="text-xs text-zinc-500 ml-1">/mois</span></p>
                          <p className="text-[9px] text-zinc-600 font-bold mt-1.5 leading-tight">intérêts + assurance</p>
                        </div>
                      </div>
                      <div>
                        <div className="h-2.5 rounded-full bg-rose-500/40 overflow-hidden border border-white/5">
                          <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-500" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-[9px] text-zinc-500 font-bold mt-2">{Math.round(pct)}% de la mensualité est de l'épargne</p>
                      </div>
                    </div>
                  );
                })()}

                {/* JALONS */}
                <div className="bg-zinc-900/30 border border-white/5 rounded-[2.5rem] p-6">
                  <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-4">Jalons</p>
                  <div className="space-y-3">
                    {reStats.milestones.filter(m => m.date).map(m => (
                      <div key={m.key} className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full shrink-0 border-2 ${m.done ? 'bg-violet-400 border-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.7)]' : 'border-zinc-600'}`} />
                        <p className={`flex-1 text-xs font-black uppercase ${m.done ? 'text-violet-300' : 'text-zinc-300'}`}>{m.label}</p>
                        <div className="text-right">
                          <p className="text-xs font-black italic text-white">{m.date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}</p>
                          <p className="text-[9px] text-zinc-600 font-bold">{m.done ? 'atteint' : `dans ${fmtDuration(m.n - reStats.paid)}`}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* COÛT TOTAL DU CRÉDIT */}
                <div className="bg-zinc-900/30 border border-white/5 rounded-[2.5rem] p-6 space-y-3">
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Coût du crédit payé</p>
                      <p className="text-2xl font-black italic text-rose-400">{Math.round(reStats.costPaid).toLocaleString()}€<span className="text-xs text-zinc-500 ml-2">/ {Math.round(reStats.totalCost).toLocaleString()}€</span></p>
                      <p className="text-[9px] text-zinc-600 font-bold mt-1">intérêts + assurance sur toute la durée</p>
                    </div>
                    <p className="text-xl font-black italic text-white">{reStats.totalCost > 0 ? ((reStats.costPaid / reStats.totalCost) * 100).toFixed(1) : '0.0'}%</p>
                  </div>
                  <div className="h-2.5 rounded-full bg-black/50 overflow-hidden border border-white/5">
                    <div className="h-full rounded-full bg-rose-500/80" style={{ width: `${reStats.totalCost > 0 ? Math.min(100, (reStats.costPaid / reStats.totalCost) * 100) : 0}%` }} />
                  </div>
                </div>

                {/* STATS */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['Valeur du bien', `${Math.round(Number(realEstate.value) || 0).toLocaleString()}€`, 'estimation actuelle, modifiable dans les réglages', true],
                    ['Restant dû', `${Math.round(reStats.crd).toLocaleString()}€`, `fin ${fmtDate(reStats.endDate)}`],
                    ['LTV', `${reStats.ltv.toFixed(1)}%`, 'dette / valeur du bien'],
                    ['Indemnité de RA', `${Math.round(reStats.ira).toLocaleString()}€`, reStats.ira > 0 ? 'semestre d\'intérêts, plafond 3 % du CRD' : 'gratuite (15 ans de remboursement)'],
                    ['Mainlevée hypothèque', `${Math.round(reStats.releaseFees).toLocaleString()}€`, 'estimation, éditable'],
                    ['Fonds propres investis', `${Math.round(reStats.equityInvested).toLocaleString()}€`, 'apport + capital remboursé'],
                    ["Part de l'apport", `${reStats.apportShare.toFixed(1)}%`, `${Math.round(Number(realEstate.apport) || 0).toLocaleString()}€ sur ${Math.round(Number(realEstate.loan.principal) + (Number(realEstate.apport) || 0)).toLocaleString()}€`],
                    ['Intérêts payés', `${Math.round(reStats.interestPaid).toLocaleString()}€`, `sur ${Math.round(reStats.totalCost - reStats.schedule.length * (Number(realEstate.loan.insurance) || 0)).toLocaleString()}€ au total`],
                    ['Assurance payée', `${Math.round(reStats.insurancePaid).toLocaleString()}€`, `${Number(realEstate.loan.insurance).toLocaleString('fr-FR')}€ /mois`],
                    ['Mensualité', `${(Number(realEstate.loan.payment) + Number(realEstate.loan.insurance || 0)).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}€`, 'assurance comprise'],
                    ['Échéances restantes', `${reStats.remaining}`, `${Math.floor(reStats.remaining / 12)} ans ${reStats.remaining % 12} mois`],
                  ].map(([lbl, val, sub, wide]) => (
                    <div key={lbl} className={`bg-zinc-900/30 border border-white/5 rounded-[2rem] p-5 ${wide ? 'col-span-2' : ''}`}>
                      <p className="text-[9px] font-black uppercase text-zinc-500 tracking-widest leading-tight">{lbl}</p>
                      <p className="text-lg font-black italic text-white mt-1 leading-none">{val}</p>
                      <p className="text-[9px] text-zinc-600 font-bold mt-1.5 leading-tight">{sub}</p>
                    </div>
                  ))}
                </div>

                {/* PROCHAINE ÉCHÉANCE */}
                {reStats.next ? (
                  <div className="bg-zinc-900/30 border border-violet-500/20 rounded-[2.5rem] p-6 flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-black uppercase text-violet-400 tracking-widest">Prochain prélèvement</p>
                      <p className="text-sm font-black italic text-white mt-1">{fmtDate(reStats.next.date)}</p>
                      <p className="text-[9px] text-zinc-500 font-bold mt-1">{reStats.next.capital.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}€ capital · {reStats.next.interest.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}€ intérêts · {reStats.next.insurance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}€ assurance</p>
                    </div>
                    <p className="text-2xl font-black italic text-violet-300">{(reStats.next.capital + reStats.next.interest + reStats.next.insurance).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}€</p>
                  </div>
                ) : (
                  <div className="bg-zinc-900/30 border border-emerald-500/20 rounded-[2.5rem] p-6 text-center">
                    <p className="text-[10px] font-black uppercase text-emerald-400 tracking-widest">Crédit soldé</p>
                  </div>
                )}

                {/* GRAPHES : où part la mensualité / qui possède le bien */}
                <div className="bg-zinc-900/30 border border-white/5 rounded-[2.5rem] p-5">
                  <div className="flex gap-2 mb-3">
                    {[['years', 'Mensualités'], ['own', 'Propriété']].map(([k, lbl]) => (
                      <button key={k} onClick={() => setReView(k)} className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${reView === k ? 'bg-violet-500/20 border-violet-500/50 text-violet-300' : 'border-white/5 text-zinc-500'}`}>{lbl}</button>
                    ))}
                  </div>
                  {reView === 'years' ? (
                    <>
                      <div className="flex justify-between items-center px-2 mb-3">
                        <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Où part ma mensualité</p>
                        <div className="flex gap-2.5 text-[9px] font-black uppercase">
                          <span className="text-violet-300">● Capital</span>
                          <span className="text-rose-400">● Intérêts</span>
                          <span className="text-zinc-500">● Assur.</span>
                        </div>
                      </div>
                      <div className="h-52">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={reStats.years} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />
                            <XAxis dataKey="year" tick={{ fill: '#52525b', fontSize: 9, fontWeight: 700 }} axisLine={false} tickLine={false} interval={4} />
                            <YAxis tick={{ fill: '#52525b', fontSize: 9, fontWeight: 700 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={38} />
                            <Tooltip content={<RealEstateYearTooltip />} cursor={{ fill: '#ffffff08' }} />
                            <Bar dataKey="capital" stackId="y" isAnimationActive={false}>
                              {reStats.years.map(y => <Cell key={y.year} fill={y.year === new Date().getFullYear() ? '#c4b5fd' : '#8b5cf6'} />)}
                            </Bar>
                            <Bar dataKey="interest" stackId="y" isAnimationActive={false}>
                              {reStats.years.map(y => <Cell key={y.year} fill={y.year === new Date().getFullYear() ? '#fb7185' : '#be123c'} />)}
                            </Bar>
                            <Bar dataKey="insurance" stackId="y" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                              {reStats.years.map(y => <Cell key={y.year} fill={y.year === new Date().getFullYear() ? '#a1a1aa' : '#52525b'} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="text-[9px] text-zinc-600 font-bold px-2 mt-2">Barre claire = année en cours. La première et la dernière année sont partielles.</p>
                    </>
                  ) : (
                    (() => {
                      // Lecture directe sans toucher : 100 % empilé, banque (rose, en haut) qui
                      // rétrécit, part à vous (violet, en bas) qui grandit ; chiffres du jour en tête.
                      const now = reStats.chart[Math.max(1, reStats.paid) - 1] || reStats.chart[0];
                      const half = reStats.milestones[0];
                      return (
                        <>
                          <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest px-2 mb-3">Qui possède l'appart</p>
                          <div className="grid grid-cols-2 gap-2 mb-3">
                            <div className="rounded-[1.25rem] border border-violet-500/30 bg-violet-500/10 px-3 py-2.5">
                              <p className="text-[9px] font-black uppercase tracking-widest text-violet-300">À vous aujourd'hui</p>
                              <p className="text-xl font-black italic text-violet-200 leading-none mt-1">{Math.round(now.ownPct)}%</p>
                              <p className="text-[9px] font-bold text-zinc-500 mt-1">{now.owned.toLocaleString()}€</p>
                            </div>
                            <div className="rounded-[1.25rem] border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-right">
                              <p className="text-[9px] font-black uppercase tracking-widest text-rose-300">Banque aujourd'hui</p>
                              <p className="text-xl font-black italic text-rose-300 leading-none mt-1">{Math.round(now.bankPct)}%</p>
                              <p className="text-[9px] font-bold text-zinc-500 mt-1">{now.crd.toLocaleString()}€</p>
                            </div>
                          </div>
                          <div className="h-52 relative">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={reStats.chart} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                                <XAxis dataKey="n" tick={{ fill: '#52525b', fontSize: 9, fontWeight: 700 }} axisLine={false} tickLine={false} interval={35} tickFormatter={(n) => { const d = reStats.chart[n - 1]?.date; return d ? String(d.getFullYear()) : ''; }} />
                                <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fill: '#52525b', fontSize: 9, fontWeight: 700 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={38} />
                                <Tooltip content={<RealEstateOwnTooltip />} cursor={{ stroke: '#ffffff40' }} />
                                <Area type="monotone" dataKey="ownPct" stackId="o" stroke="#a78bfa" strokeWidth={2} fill="#8b5cf6" fillOpacity={0.55} dot={false} isAnimationActive={false} />
                                <Area type="monotone" dataKey="bankPct" stackId="o" stroke="#fb7185" strokeWidth={0} fill="#f43f5e" fillOpacity={0.28} dot={false} isAnimationActive={false} />
                                <ReferenceLine y={50} stroke="#ffffff30" strokeDasharray="3 3" />
                                <ReferenceLine x={now.n} stroke="#ffffff" strokeOpacity={0.7} strokeDasharray="4 4" label={{ value: "aujourd'hui", position: 'insideTopRight', fill: '#e4e4e7', fontSize: 8, fontWeight: 800 }} />
                                {half.n && <ReferenceLine x={half.n} stroke="#e879f9" strokeDasharray="2 4" label={{ value: `50/50 · ${half.date.getFullYear()}`, position: 'insideBottomLeft', fill: '#f5d0fe', fontSize: 8, fontWeight: 800 }} />}
                              </AreaChart>
                            </ResponsiveContainer>
                            {/* Étiquettes posées dans les zones : la banque occupe le haut-gauche, vous le bas-droit */}
                            <p className="pointer-events-none absolute left-12 top-3 text-[10px] font-black uppercase tracking-widest text-rose-200/90">Banque</p>
                            <p className="pointer-events-none absolute right-3 bottom-8 text-[10px] font-black uppercase tracking-widest text-violet-100">À vous</p>
                          </div>
                          <p className="text-[9px] text-zinc-600 font-bold px-2 mt-2">La zone rose (dette) rétrécit à chaque prélèvement, la zone violette (votre part) grandit jusqu'à 100 % en {reStats.endDate ? reStats.endDate.getFullYear() : '—'}.</p>
                        </>
                      );
                    })()
                  )}
                </div>

                {/* SIMULATION DE REVALORISATION (non enregistrée) — data-no-swipe : glisser le curseur ne change pas d'onglet */}
                <div data-no-swipe className="bg-zinc-900/30 border border-white/5 rounded-[2.5rem] p-6 space-y-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Revalorisation du bien</p>
                      <p className="text-[9px] text-zinc-600 font-bold mt-1">simulation, n'est pas enregistrée</p>
                    </div>
                    <p className={`text-2xl font-black italic ${reGrowth > 0 ? 'text-emerald-400' : reGrowth < 0 ? 'text-rose-400' : 'text-white'}`}>{reGrowth > 0 ? '+' : ''}{reGrowth.toLocaleString('fr-FR')}%<span className="text-xs text-zinc-500 ml-1">/an</span></p>
                  </div>
                  <input type="range" min={-2} max={3} step={0.5} value={reGrowth} onChange={e => setReGrowth(Number(e.target.value))} className="w-full h-8 accent-violet-500 cursor-pointer" />
                  {/* MINI-COURBE : actif net fin d'année, on la parcourt du doigt pour choisir l'année */}
                  {reStats.netYears.length > 0 && (() => {
                    const pts = reStats.netYears;
                    const sel = pts.find(p => p.year === reYear)
                      || (reYear < pts[0].year ? pts[0] : pts[pts.length - 1]);
                    const delta = sel.net - reStats.netAsset;
                    const pick = (st) => {
                      const i = Number(st?.activeTooltipIndex);
                      if (Number.isInteger(i) && pts[i]) setReYear(pts[i].year);
                    };
                    return (
                      <div className="bg-black/30 border border-white/5 rounded-[1.5rem] p-4">
                        <div className="flex justify-between items-end gap-3">
                          <div>
                            <p className="text-[9px] font-black uppercase text-zinc-500 tracking-widest">Actif net fin {sel.year}</p>
                            <p className="text-3xl font-black italic text-violet-200 mt-1 leading-none">{sel.net.toLocaleString()}€</p>
                          </div>
                          <p className={`text-xs font-black italic shrink-0 ${delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{delta >= 0 ? '+' : ''}{delta.toLocaleString()}€<span className="block text-[9px] not-italic font-bold text-zinc-600 text-right">vs aujourd'hui</span></p>
                        </div>
                        <div className="h-28 mt-3 touch-none select-none cursor-crosshair">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={pts} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                              onMouseDown={pick} onMouseMove={(st, e) => { if (e?.buttons === 1) pick(st); }} onClick={pick}
                              onTouchStart={pick} onTouchMove={pick}>
                              <defs>
                                <linearGradient id="reYears" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.45} />
                                  <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.02} />
                                </linearGradient>
                              </defs>
                              <XAxis dataKey="year" type="category" tick={{ fill: '#52525b', fontSize: 9, fontWeight: 700 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                              <YAxis hide domain={['dataMin', 'dataMax']} />
                              <Tooltip content={() => null} cursor={false} />
                              <ReferenceLine x={sel.year} stroke="#c4b5fd" strokeDasharray="3 3" />
                              <Area type="monotone" dataKey="net" stroke="#a78bfa" strokeWidth={2} fill="url(#reYears)" isAnimationActive={false}
                                dot={(p) => (p.payload.year === sel.year
                                  ? <circle key={p.payload.year} cx={p.cx} cy={p.cy} r={5} fill="#c4b5fd" stroke="#18181b" strokeWidth={2} />
                                  : <g key={p.payload.year} />)} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                        <p className="text-[9px] text-zinc-600 font-bold mt-2 text-center">Glisse le doigt sur la courbe pour choisir l'année</p>
                      </div>
                    );
                  })()}
                  <p className="text-[9px] text-zinc-600 font-bold leading-relaxed">S'applique à partir d'aujourd'hui : l'actif net du jour ne bouge pas. Modifie la « Propriété », les jalons et la courbe.</p>
                </div>
              </>
            )}
          </div>
        )}

        {/* --- PAGE PERSO (AVEC TOTAL MENSUEL AJOUTÉ) --- */}
        {activeTab === 'personal' && (
          <div className="space-y-8 page-transition">
            {/* TOTAL FIXE MENSUEL */}
            <div className="bg-zinc-900/80 border border-white/10 rounded-[2.5rem] p-6 flex justify-between items-center relative overflow-hidden neon-pulse neon-pulse-ruby">
              <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/20 blur-xl"></div>
              <div>
                <p className="text-[10px] font-black uppercase text-rose-400 tracking-widest">Total Mensuel Fixe</p>
                <p className="text-3xl font-black italic text-white">{personalTotal.toLocaleString()}€</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black uppercase text-emerald-500 tracking-widest leading-none mb-1">Pointées</p>
                <p className="text-2xl font-black italic text-emerald-400">{personalExpenses.filter(i => i.isPaid).length}<span className="text-sm text-zinc-500">/{personalExpenses.length}</span></p>
              </div>
            </div>

            <div className="flex justify-between items-center px-4 pt-4">
              <h2 className="text-2xl font-black italic tracking-tighter uppercase leading-none">Mes Charges</h2>
              <button onClick={() => setModal({ open: true, type: 'create_personal_expense' })} className="w-12 h-12 bg-rose-600 rounded-3xl flex items-center justify-center shadow-lg transition-all"><Plus size={24} /></button>
            </div>

            <Reorder.Group axis="y" values={personalExpenses} onReorder={(newList) => setPersonalExpenses(newList)} className="space-y-3 pb-4">
              {personalExpenses.map(item => (
                <DraggableItem key={item.id} value={item}>
                  <div className={`p-4 rounded-[2.8rem] border transition-all active:scale-95 flex justify-between items-center group relative overflow-hidden bg-zinc-900/30 border-white/5`}>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => togglePersonalPaid(item.id)}
                        className={`w-9 h-9 rounded-full flex items-center justify-center border transition-all ${item.isPaid ? 'neon-pulse neon-pulse-green border-emerald-500 text-emerald-500' : 'border-zinc-700 text-transparent hover:border-emerald-500'}`}
                      >
                        <Check size={18} strokeWidth={4} className="relative z-10" />
                      </button>
                      <div className="flex flex-col">
                        <p className={`text-sm font-black uppercase text-left text-zinc-200`}>{item.label}</p>
                        {item.label.toLowerCase().includes('essence') ? (
                          <div className="flex items-center gap-2 mt-1 bg-black/30 px-2 py-1 rounded-lg border border-white/5">
                            <MessageSquare size={10} className="text-zinc-500" />
                            <input
                              type="text"
                              placeholder="Km..."
                              className="bg-transparent w-20 text-[10px] font-bold text-zinc-300 outline-none placeholder:text-zinc-700"
                              value={item.comment || ''}
                              onChange={(e) => updatePersonalComment(item.id, e.target.value)}
                            />
                          </div>
                        ) : (
                          <p className="text-[8px] text-zinc-600 font-bold uppercase tracking-widest text-left">Charge Perso</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col items-end">
                        <span className={`text-xl font-black italic text-rose-400`}>{Number(item.amount).toLocaleString()}€</span>
                        <div className="flex gap-2">
                          <button onClick={() => { setForm({ label: item.label, amount: item.amount, cat: 'fixed', startDate: '' }); setModal({ open: true, type: 'create_personal_expense', data: item }); }} className="text-zinc-600 hover:text-white"><Pencil size={14} /></button>
                          <button onClick={() => { if (window.confirm('Supprimer ?')) setPersonalExpenses(personalExpenses.filter(i => i.id !== item.id)) }} className="text-zinc-600 hover:text-red-500"><Trash2 size={14} /></button>
                        </div>
                      </div>
                      <DragHandle />
                    </div>
                  </div>
                </DraggableItem>
              ))}
            </Reorder.Group>
          </div>
        )}

        {/* --- PAGE CHARGES FIXES --- */}
        {activeTab === 'expenses' && (
          <div className="space-y-10 pb-4 text-white page-transition">
            <div className="flex justify-between items-center px-4">
              <h2 className="text-3xl font-black italic tracking-tighter uppercase leading-none">Charges communes</h2>
              <button onClick={() => setModal({ open: true, type: 'expense' })} className="w-14 h-14 bg-pink-400/30 border border-pink-300/30 text-pink-100 rounded-3xl flex items-center justify-center shadow-lg transition-all"><Plus size={28} /></button>
            </div>

            {/* TOTAL GLOBAL ET VIREMENT */}
            <div className="bg-zinc-900/80 border border-white/10 rounded-[2.5rem] p-6 flex justify-between items-center relative overflow-hidden neon-pulse neon-pulse-pink">
              <div className="absolute top-0 right-0 w-24 h-24 bg-pink-400/10 blur-xl"></div>
              <div>
                <p className="text-[10px] font-black uppercase text-pink-300 tracking-widest">Total Mensuel</p>
                <p className="text-3xl font-black italic text-white">{(totals.totalFixed + totals.provision).toLocaleString()}€</p>
                <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">{totals.totalFixed.toLocaleString()}€ fixe + {totals.provision.toLocaleString()}€ provision</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black uppercase text-pink-300 tracking-widest leading-none mb-1">Virement / P</p>
                <p className="text-2xl font-black italic text-pink-300">{totals.virement.toLocaleString()}€</p>
              </div>
            </div>
            <section className="space-y-8">
              <div className="space-y-4">
                <div className="flex justify-between px-4 items-end">
                  <p className="text-[10px] font-black text-pink-300 uppercase tracking-[0.4em] italic leading-none">Mensuel Fixe</p>
                  <p className="text-xl font-black italic text-pink-300 leading-none">{totals.totalFixed.toLocaleString()}€</p>
                </div>
                <Reorder.Group axis="y" values={fixedExpenses} onReorder={(newList) => setFixedExpenses(newList)} className="bg-zinc-900/20 border border-pink-400/10 rounded-[3rem] p-2 space-y-2">
                  {fixedExpenses.map(e => (
                    <DraggableItem key={e.id} value={e}>
                      <div className="bg-zinc-900/30 border border-white/5 p-4 rounded-[2.8rem] flex justify-between items-center group active:scale-95 relative overflow-hidden">
                        <div className="absolute left-2 top-5 bottom-5 w-1 rounded-full bg-pink-300/70" />
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-pink-400/10 rounded-xl flex items-center justify-center text-pink-300">{getIcon(e.name)}</div>
                          <div>
                            <p className="text-sm font-black italic uppercase text-left">{e.name}</p>
                            <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest text-left">Charge Fixe</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col items-end">
                            <span className="text-xl font-black italic text-pink-300">{Number(e.amount).toLocaleString()}€</span>
                            <div className="flex gap-2">
                              <button onClick={() => { setForm({ label: e.name, amount: e.amount, cat: 'fixed', startDate: '' }); setModal({ open: true, type: 'expense', data: e }); }} className="text-zinc-600 hover:text-white"><Pencil size={14} /></button>
                              <button onClick={() => { const n = fixedExpenses.filter(x => x.id !== e.id); setFixedExpenses(n); }} className="text-zinc-600 hover:text-red-500"><Trash2 size={14} /></button>
                            </div>
                          </div>
                          <DragHandle />
                        </div>
                      </div>
                    </DraggableItem>
                  ))}
                </Reorder.Group>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between px-4 items-end">
                  <p className="text-[10px] font-black text-amber-400 uppercase tracking-[0.4em] italic leading-none">Provisions Annuelles</p>
                  <div className="text-right">
                    <p className="text-xl font-black italic text-amber-400 leading-none">{totals.totalAnnual.toLocaleString()}€<span className="text-[10px] text-amber-600 not-italic font-bold"> /an</span></p>
                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">≈ {totals.provision.toLocaleString()}€ /mois</p>
                  </div>
                </div>
                {/* Les dépenses programmées (`noProvision`) partagent ce tableau mais
                    s'affichent sur le dashboard : on les garde hors de cette liste. */}
                <Reorder.Group axis="y" values={provisionItems} onReorder={(newList) => setAnnualExpenses([...newList, ...annualExpenses.filter(e => e.noProvision)])} className="bg-zinc-900/20 border border-amber-500/20 rounded-[3rem] p-2 space-y-2">
                  {provisionItems.map(e => (
                    <DraggableItem key={e.id} value={e}>
                      <div className="bg-zinc-900/30 border border-white/5 p-4 rounded-[2.8rem] flex justify-between items-center group active:scale-95 relative overflow-hidden">
                        <div className="absolute left-2 top-5 bottom-5 w-1 rounded-full bg-amber-400" />
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center text-amber-400"><Calendar size={18} /></div>
                          <div>
                            <p className="text-sm font-black italic uppercase text-left">{e.name}</p>
                            {dueList(e).length > 0
                              ? <p className="text-[8px] text-amber-400 font-black uppercase tracking-widest text-left">
                                  {dueList(e).length > 1
                                    ? `${dueList(e).length} prélèvements · ${Math.round(dueTotal(e)).toLocaleString()}€ · dès ${new Date(dueList(e)[0].date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`
                                    : `Prélèvement ${new Date(dueList(e)[0].date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} · ${Math.round(dueTotal(e)).toLocaleString()}€`}
                                </p>
                              : <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest text-left">{e.startDate ? `Dès ${new Date(e.startDate).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}` : 'Provision'}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col items-end">
                            <span className="text-xl font-black italic text-amber-400">{Number(e.amount).toLocaleString()}€<span className="text-[10px] text-zinc-500 not-italic font-bold"> · {Math.round((Number(e.amount) || 0) / 12).toLocaleString()}€/m</span></span>
                            <div className="flex gap-2">
                              <button onClick={() => { const l = dueList(e); setDueDraft(l.length ? l.map((d, i) => ({ id: d.id ?? Date.now() + i, date: d.date, amount: String(d.amount ?? '') })) : [{ id: Date.now(), date: '', amount: String(e.amount ?? '') }]); setModal({ open: true, type: 'due_date', data: e }); }} className={dueList(e).length ? 'text-amber-400' : 'text-zinc-600 hover:text-amber-400'}><CalendarClock size={14} /></button>
                              <button onClick={() => { setForm({ label: e.name, amount: e.amount, cat: 'annual', startDate: e.startDate || '' }); setModal({ open: true, type: 'expense', data: e }); }} className="text-zinc-600 hover:text-white"><Pencil size={14} /></button>
                              <button onClick={() => { const n = annualExpenses.filter(x => x.id !== e.id); setAnnualExpenses(n); }} className="text-zinc-600 hover:text-red-500"><Trash2 size={14} /></button>
                            </div>
                          </div>
                          <DragHandle />
                        </div>
                      </div>
                    </DraggableItem>
                  ))}
                </Reorder.Group>
              </div>
            </section>
          </div>
        )}

        {/* --- HISTORIQUE --- */}
        {activeTab === 'history' && (
          <div className="space-y-8 pb-4 page-transition">
            <div className="bg-gradient-to-br from-zinc-900 to-slate-700/60 rounded-[3.5rem] p-10 border border-white/5 shadow-2xl relative neon-pulse neon-pulse-platinum">
              <p className="text-slate-300 text-[10px] font-black uppercase mb-1 italic">Journal des Flux</p>
              <h2 className="text-7xl font-black italic tracking-tighter leading-none">{history.filter(h => showArchives ? h.isArchived : !h.isArchived).length}</h2>
              <button onClick={() => setShowArchives(!showArchives)} className="absolute top-8 right-8 bg-black/20 p-3 rounded-2xl text-slate-200 hover:bg-black/40 transition-all flex items-center gap-2">
                <Archive size={18} />
                <span className="text-[10px] font-bold uppercase">{showArchives ? "Actifs" : "Archives"}</span>
              </button>
            </div>
            <Reorder.Group axis="y" values={history} onReorder={(newList) => setHistory(newList)} className="space-y-4">
              {history.filter(h => showArchives ? h.isArchived : !h.isArchived).map(h => (
                <DraggableItem key={h.id} value={h}>
                  <div className={`bg-zinc-900/30 border border-white/5 p-6 rounded-[2.5rem] flex justify-between items-center relative group transition-all active:scale-95 ${h.isArchived ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className={`min-w-12 w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${h.type === 'payment' ? 'bg-red-500/10 text-red-500' : h.type === 'reimb' ? 'bg-emerald-500/10 text-emerald-500' : h.type === 'advance' ? 'bg-amber-500/10 text-amber-500' : 'bg-teal-500/10 text-teal-400'}`}>
                        {h.type === 'payment' ? <ArrowUpRight size={20} /> : h.type === 'reimb' ? <ArrowDownLeft size={20} /> : h.type === 'advance' ? <Coins size={20} /> : <HistoryIcon size={20} />}
                      </div>
                      <div className="flex flex-col gap-2 min-w-0 pr-2">
                        <div>
                          <p className="text-sm font-black italic uppercase truncate">{h.label}</p>
                          <p className="text-[8px] text-zinc-600 font-bold uppercase">{h.date}</p>
                        </div>
                        <div className="flex gap-2 items-center bg-black/20 p-2 w-max rounded-xl border border-white/5">
                          <button onClick={() => handleArchiveHistory(h)} className="text-zinc-500 hover:text-amber-500"><Archive size={16} /></button>
                          {!h.isArchived && <button onClick={() => handleEditHistory(h)} className="text-zinc-500 hover:text-slate-200"><Pencil size={16} /></button>}
                          <button onClick={() => handleDeleteHistory(h)} className="text-zinc-500 hover:text-red-500"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 relative z-10">
                      <span className={`font-black italic text-xl ${h.type === 'payment' ? 'text-red-500' : h.type === 'reimb' ? 'text-emerald-500' : h.type === 'advance' ? 'text-amber-500' : 'text-teal-400'}`}>
                        {h.type === 'payment' || h.type === 'advance' ? '-' : '+'}{Number(h.amount).toLocaleString()}€
                      </span>
                      <DragHandle />
                    </div>
                  </div>
                </DraggableItem>
              ))}
            </Reorder.Group>
          </div>
        )}
        {/* --- MODAL --- */}
        {modal.open && (
          <div className="fixed inset-0 bg-black/95 backdrop-blur-2xl z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="bg-zinc-900 border border-white/10 w-full max-w-md mx-auto rounded-[3.5rem] p-10 shadow-2xl animate-spring-in max-h-[88vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-10">
                <h2 className="text-2xl font-black italic uppercase text-white">
                  {modal.type === 'create_savings_account' ? 'Nouveau Compte' : modal.type === 'savings_transaction' ? 'Mouvement' : modal.type === 'savings_advance' ? 'Avance Épargne' : modal.type === 'create_personal_expense' ? 'Dépense Perso' : modal.type === 'portfolio' ? 'Portefeuille' : modal.type === 'rename_savings' ? 'Renommer' : modal.type === 'due_date' ? 'Échéances' : (modal.type === 'exceptional' && dueDraft.length > 0) ? 'Dépense programmée' : (modal.type === 'add_crypto' || modal.type === 'edit_crypto') ? 'Crypto' : modal.type === 'realestate' ? 'Mon bien' : 'Opération'}
                </h2>
                <button onClick={() => { setModal({ open: false, type: '', data: null }); setDueDraft([]); setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '', startDate: '' }) }} className="text-zinc-600"><X size={28} /></button>
              </div>

              <form onSubmit={handleForm} className="space-y-8">
                {(modal.type === 'due_date' || (modal.type === 'exceptional' && dueDraft.length > 0)) && (
                  <div className="space-y-4">
                    {modal.type === 'due_date' && <div className="bg-black/40 border border-amber-500/20 rounded-2xl p-5">
                      <p className="text-[9px] font-black uppercase tracking-widest text-amber-600 leading-none mb-2">Provision annuelle</p>
                      <p className="text-lg font-black italic uppercase text-amber-400 leading-none">{modal.data?.name}</p>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mt-2">Prévisionnel {Number(modal.data?.amount || 0).toLocaleString()}€ /an</p>
                    </div>}

                    <p className="text-[10px] font-black uppercase text-amber-500 pl-2">Prélèvements prévus</p>
                    {dueDraft.map((d, i) => (
                      <div key={d.id} className="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 w-5 text-center text-[10px] font-black text-amber-600">{i + 1}</span>
                          <input
                            type="date"
                            className="flex-1 min-w-0 bg-black/50 border border-white/10 rounded-xl px-3 py-2.5 outline-none focus:border-amber-500 font-bold text-white text-sm [color-scheme:dark]"
                            value={d.date}
                            onChange={ev => setDueDraft(dueDraft.map(x => x.id === d.id ? { ...x, date: ev.target.value } : x))} />
                          <button type="button" onClick={() => setDueDraft(dueDraft.filter(x => x.id !== d.id))} className="shrink-0 text-zinc-700 hover:text-red-500 p-1" aria-label="Supprimer cette échéance"><X size={16} /></button>
                        </div>
                        <div className="flex items-center gap-2 pl-7">
                          <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Montant</span>
                          <input
                            type="number" step="0.01" inputMode="decimal" placeholder="0"
                            className="flex-1 min-w-0 bg-black/50 border border-white/10 rounded-xl px-3 py-2.5 outline-none focus:border-amber-500 font-black text-amber-400 text-sm text-right"
                            value={d.amount}
                            onChange={ev => setDueDraft(dueDraft.map(x => x.id === d.id ? { ...x, amount: ev.target.value } : x))} />
                          <span className="text-sm font-black text-zinc-600 pr-1">EUR</span>
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => setDueDraft([...dueDraft, { id: Date.now(), date: '', amount: '' }])}
                      className="w-full py-3 rounded-2xl border border-dashed border-amber-500/40 text-amber-500 font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-amber-500/10 transition-colors">
                      <Plus size={16} /> Ajouter une échéance
                    </button>

                    {dueDraft.length > 0 && (() => {
                      const tot = dueDraft.reduce((a, d) => a + (parseFloat(String(d.amount).replace(',', '.')) || 0), 0);
                      const ecart = modal.type === 'due_date' ? Math.round(tot - (Number(modal.data?.amount) || 0)) : 0;
                      return (
                        <div className="flex justify-between items-baseline px-2 pt-1">
                          <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Total {dueDraft.length} échéance{dueDraft.length > 1 ? 's' : ''}</span>
                          <span className="text-right">
                            <span className="text-lg font-black italic text-amber-400">{Math.round(tot).toLocaleString()}€</span>
                            {ecart !== 0 && <span className="block text-[9px] font-bold text-zinc-600">{ecart > 0 ? '+' : ''}{ecart.toLocaleString()}€ vs prévisionnel</span>}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Nouvelle avance ou cumul sur une avance déjà ouverte (dashboard + épargne). */}
                {(modal.type === 'pending' || modal.type === 'savings_advance') && (() => {
                  const list = modal.type === 'pending' ? pending : savingsPending;
                  if (list.length === 0) return null;
                  const sel = list.find(p => p.id === form.targetPending);
                  const add = parseFloat(String(form.amount).replace(',', '.')) || 0;
                  return (
                    <div className="space-y-3">
                      <p className="text-[10px] font-black uppercase text-amber-500 pl-2">Avance</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setForm({ ...form, targetPending: '' })} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase border ${!form.targetPending ? 'bg-amber-500 border-amber-500 text-black' : 'border-zinc-800 text-zinc-500'}`}>+ Nouvelle</button>
                        {list.map(p => (
                          <button type="button" key={p.id} onClick={() => setForm({ ...form, targetPending: p.id })} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase border ${form.targetPending === p.id ? 'bg-amber-500 border-amber-500 text-black' : 'border-zinc-800 text-zinc-500'}`}>{p.label} · {Number(p.amount).toLocaleString()}€</button>
                        ))}
                      </div>
                      {sel && (
                        <div className="bg-black/40 border border-amber-500/20 rounded-2xl p-5">
                          <p className="text-[9px] font-black uppercase tracking-widest text-amber-600 leading-none mb-2">Cumul sur avance existante</p>
                          <p className="text-lg font-black italic uppercase text-amber-400 leading-none">{sel.label}</p>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mt-2">{Number(sel.amount).toLocaleString()}€ <span className="text-zinc-700">→</span> <span className="text-amber-400">{Math.round(sel.amount + add).toLocaleString()}€</span></p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {modal.type !== 'due_date' && modal.type !== 'repay_partial' && modal.type !== 'repay_savings_advance' && modal.type !== 'savings_transaction' && modal.type !== 'portfolio' && modal.type !== 'add_crypto' && modal.type !== 'edit_crypto' && !form.targetPending && (
                  <div className="space-y-6">
                    {modal.type === 'expense' && (
                      <div className="flex gap-2 bg-black/50 p-1 rounded-2xl">
                        <button type="button" onClick={() => setForm({ ...form, cat: 'fixed' })} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${form.cat === 'fixed' ? 'bg-pink-400/30 border border-pink-300/30 text-pink-100' : 'text-zinc-600'}`}>Mensuel</button>
                        <button type="button" onClick={() => setForm({ ...form, cat: 'annual' })} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${form.cat === 'annual' ? 'bg-amber-500 text-black' : 'text-zinc-600'}`}>Annuel</button>
                      </div>
                    )}
                    <input autoFocus className="w-full bg-black/50 border border-white/10 rounded-2xl p-6 outline-none focus:border-emerald-500 font-bold text-lg text-white" placeholder="Nom / Libellé" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
                    {modal.type === 'expense' && form.cat === 'annual' && (
                      <div className="space-y-2">
                        <p className="text-[10px] font-black uppercase text-emerald-500 pl-4">Date de démarrage (optionnel)</p>
                        <input type="date" className="w-full bg-black/50 border border-white/10 rounded-2xl p-5 outline-none focus:border-emerald-500 font-bold text-white [color-scheme:dark]" value={form.startDate || ''} onChange={e => setForm({ ...form, startDate: e.target.value })} />
                        <p className="text-[9px] text-zinc-600 font-bold pl-4 leading-tight">Sans date : cumul rétroactif depuis janvier. Avec date : cumul à partir du mois choisi.</p>
                      </div>
                    )}
                  </div>
                )}

                {(modal.type === 'savings_transaction' || (modal.type === 'savings_advance' && !form.targetPending)) && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase text-zinc-500 pl-4">Compte Cible</p>
                    <div className="flex flex-wrap gap-2">
                      {savingsAccounts.filter(isMoneyAccount).map(acc => (
                        <button type="button" key={acc.id} onClick={() => setForm({ ...form, targetAccount: acc.id })} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase border ${form.targetAccount === acc.id ? 'bg-amber-500 border-amber-500 text-black' : 'border-zinc-800 text-zinc-500'}`}>{acc.name}</button>
                      ))}
                    </div>
                  </div>
                )}

                {modal.type === 'portfolio' && (
                  <div className="space-y-4">
                    <p className="text-[10px] font-black uppercase text-cyan-500 pl-2">Parts détenues par fonds</p>
                    {BOURSO_FUNDS.map(f => {
                      const shares = parseFloat(String(portfolioDraft[f.id] ?? '').replace(',', '.')) || 0;
                      const vl = vlMap[f.id]?.vl ?? null;
                      return (
                        <div key={f.id} className="bg-black/40 border border-white/10 rounded-2xl p-4 space-y-2">
                          <div className="flex justify-between items-baseline gap-2">
                            <span className="text-sm font-black italic uppercase text-zinc-200 leading-tight">
                              {f.name}
                              {f.ticker && <span className="ml-1.5 text-[9px] not-italic font-bold text-cyan-600 tracking-wider">ETF · {f.ticker}</span>}
                            </span>
                            <span className="text-[10px] font-mono text-zinc-500 whitespace-nowrap shrink-0">VL {vl ? vl.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '€' : (vlLoading ? '…' : '—')}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <input
                              type="text" inputMode="decimal"
                              className="flex-1 bg-black/50 border border-white/10 rounded-xl p-3 outline-none focus:border-cyan-500 font-bold text-white text-center"
                              placeholder="0"
                              value={portfolioDraft[f.id] ?? ''}
                              onChange={e => setPortfolioDraft({ ...portfolioDraft, [f.id]: e.target.value })}
                            />
                            <span className="text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap">parts</span>
                            <span className="text-sm font-black italic text-cyan-500 whitespace-nowrap w-20 text-right">{vl ? Math.round(shares * vl).toLocaleString() + '€' : '—'}</span>
                          </div>
                        </div>
                      );
                    })}
                    <div className="bg-black/40 border border-white/10 rounded-2xl p-4 space-y-2">
                      <span className="text-sm font-black italic uppercase text-zinc-200">Liquidités (non placées)</span>
                      <div className="flex items-center gap-3">
                        <input
                          type="text" inputMode="decimal"
                          className="flex-1 bg-black/50 border border-white/10 rounded-xl p-3 outline-none focus:border-cyan-500 font-bold text-white text-center"
                          placeholder="0"
                          value={portfolioDraft._cash ?? ''}
                          onChange={e => setPortfolioDraft({ ...portfolioDraft, _cash: e.target.value })}
                        />
                        <span className="text-sm font-black text-zinc-500">€</span>
                      </div>
                    </div>
                    <p className="text-[9px] text-zinc-600 font-bold pl-2 leading-tight">Valeur = (parts × VL/cours) + liquidités, arrondie à l'euro. VL des fonds et cours des ETF récupérés automatiquement sur Boursorama.</p>
                  </div>
                )}

                {modal.type === 'realestate' && (
                  <div className="space-y-5">
                    {[
                      ['label', 'Nom du bien', 'text'],
                      ['amount', 'Valeur du bien (€)', 'decimal'],
                      ['apport', 'Apport / fonds propres (€)', 'decimal'],
                      ['releaseFees', "Frais de mainlevée d'hypothèque (€)", 'decimal'],
                    ].map(([k, lbl, mode]) => (
                      <div key={k} className="space-y-2">
                        <p className="text-[10px] font-black uppercase text-violet-400 pl-4">{lbl}</p>
                        <input type="text" inputMode={mode} value={form[k] ?? ''} onChange={e => setForm({ ...form, [k]: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 font-bold outline-none focus:border-violet-500/50" />
                      </div>
                    ))}
                    <p className="text-[10px] font-black uppercase text-zinc-500 pl-4 pt-2">Crédit</p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        ['principal', 'Capital emprunté'],
                        ['rate', 'Taux annuel (%)'],
                        ['payment', 'Mensualité hors assur.'],
                        ['insurance', 'Assurance / mois'],
                        ['deferred', 'Mois de différé'],
                        ['months', "Nb d'échéances"],
                        ['iraFreeAfter', 'IRA gratuite après (échéances)'],
                      ].map(([k, lbl]) => (
                        <div key={k} className="space-y-1.5">
                          <p className="text-[9px] font-black uppercase text-zinc-500 pl-2 leading-tight">{lbl}</p>
                          <input type="text" inputMode="decimal" value={form[k] ?? ''} onChange={e => setForm({ ...form, [k]: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-3 font-bold text-sm outline-none focus:border-violet-500/50" />
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-black uppercase text-zinc-500 pl-4">1re échéance (jour de prélèvement)</p>
                      <input type="date" value={form.firstDue ?? ''} onChange={e => setForm({ ...form, firstDue: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 font-bold outline-none focus:border-violet-500/50 [color-scheme:dark]" />
                    </div>
                    <p className="text-[9px] text-zinc-600 font-bold pl-2 leading-tight">Le tableau d'amortissement est recalculé depuis ces paramètres. Les échéances sont comptées à partir de cette date, une par mois, le même jour. L'actif net déduit l'indemnité de remboursement anticipé (un semestre d'intérêts, plafonné à 3 % du restant dû) et les frais de mainlevée : c'est le net en poche si tu vendais aujourd'hui. Le loyer de marché est ce que coûterait le même logement en location, surtout pas la mensualité : une partie de celle-ci est du capital, donc de l'épargne. Les charges de propriétaire regroupent taxe foncière, charges de copropriété non récupérables et provision travaux. Les deux servent à dater le point où l'achat devient plus rentable que la location.</p>
                  </div>
                )}

                {(modal.type === 'add_crypto' || modal.type === 'edit_crypto') && (
                  <div className="space-y-5">
                    {modal.type === 'add_crypto' && (
                      <div className="space-y-2">
                        <p className="text-[10px] font-black uppercase text-orange-500 pl-2">Crypto</p>
                        <div className="flex flex-wrap gap-2">
                          {CRYPTOS.filter(c => !cryptoAssets.some(a => a.sym === c.sym) || c.sym === cryptoDraft.sym).map(c => (
                            <button type="button" key={c.sym} onClick={() => setCryptoDraft({ ...cryptoDraft, sym: c.sym })} className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase border ${cryptoDraft.sym === c.sym ? 'bg-orange-500 border-orange-500 text-black' : 'border-zinc-800 text-zinc-500'}`}>{c.sym}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="bg-black/40 border border-white/10 rounded-2xl p-4 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-black italic uppercase text-zinc-200">{cryptoName(cryptoDraft.sym)}</span>
                        <span className="text-[10px] font-mono text-zinc-500">{cryptoPrices[cryptoDraft.sym]?.price ? cryptoPrices[cryptoDraft.sym].price.toLocaleString('fr-FR', { maximumFractionDigits: cryptoPrices[cryptoDraft.sym].price < 1 ? 6 : 2 }) + '€' : (cryptoLoading ? '…' : '—')}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="text" inputMode="decimal" autoFocus
                          className="flex-1 bg-black/50 border border-white/10 rounded-xl p-3 outline-none focus:border-orange-500 font-bold text-white text-center"
                          placeholder="Volume détenu"
                          value={cryptoDraft.qty ?? ''}
                          onChange={e => setCryptoDraft({ ...cryptoDraft, qty: e.target.value })}
                        />
                        <span className="text-sm font-black italic text-orange-500 whitespace-nowrap w-20 text-right">{cryptoPrices[cryptoDraft.sym]?.price ? Math.round((parseFloat(String(cryptoDraft.qty).replace(',', '.')) || 0) * cryptoPrices[cryptoDraft.sym].price).toLocaleString() + '€' : '—'}</span>
                      </div>
                    </div>
                    <p className="text-[9px] text-zinc-600 font-bold pl-2 leading-tight">Valeur = volume × cours Coinbase (EUR), arrondie à l'euro.</p>
                  </div>
                )}

                {modal.type !== 'portfolio' && modal.type !== 'add_crypto' && modal.type !== 'edit_crypto' && modal.type !== 'rename_savings' && modal.type !== 'due_date' && !(modal.type === 'exceptional' && dueDraft.length > 0) && (
                  <div className="relative flex items-center gap-3">
                    <input type="number" step="0.01" className="w-full bg-black/50 border border-white/10 rounded-2xl p-6 outline-none focus:border-emerald-500 text-5xl font-black text-white text-center" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
                    {(modal.type === 'repay_partial' || modal.type === 'repay_savings_advance') && (
                      <button type="button" onClick={() => setForm({ ...form, amount: modal.data.amount })} className="px-4 py-8 bg-emerald-600/20 text-emerald-400 font-black uppercase text-xl rounded-2xl border border-emerald-500/20 hover:bg-emerald-600/40 transition-colors">MAX</button>
                    )}
                  </div>
                )}

                {modal.type === 'exceptional' && dueDraft.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setDueDraft([{ id: Date.now(), date: '', amount: form.amount || '' }])}
                    className="w-full py-4 rounded-2xl border border-dashed border-amber-500/40 text-amber-500 font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-amber-500/10 transition-colors">
                    <CalendarClock size={16} /> Prélèvement à venir ?
                  </button>
                )}

                {modal.type === 'savings_transaction' ? (
                  <div className="flex gap-4">
                    <button type="button" onClick={() => handleSavingsTransaction(true)} className="flex-1 py-6 rounded-[2rem] bg-emerald-600 font-black text-xl uppercase shadow-xl">Dépot</button>
                    <button type="button" onClick={() => handleSavingsTransaction(false)} className="flex-1 py-6 rounded-[2rem] bg-red-600 font-black text-xl uppercase shadow-xl">Retrait</button>
                  </div>
                ) : modal.type === 'savings_advance' ? (
                  /* CORRECTION BOUTON "CRÉER AVANCE" */
                  <button type="button" onClick={handleSavingsAdvance} className="w-full py-6 rounded-[2rem] bg-cyan-600 font-black text-xl uppercase shadow-xl">{form.targetPending ? "Ajouter à l'avance" : 'Créer Avance'}</button>
                ) : modal.type === 'portfolio' ? (
                  <button type="button" onClick={handlePortfolioSave} className="w-full py-6 rounded-[2rem] bg-cyan-600 font-black text-xl uppercase shadow-xl">Enregistrer</button>
                ) : modal.type === 'due_date' ? (
                  <div className="flex flex-col gap-3">
                    <button type="button" onClick={handleDueSave} className="w-full py-6 rounded-[2rem] bg-amber-600 font-black text-xl uppercase shadow-xl">Enregistrer</button>
                    <p className="text-[9px] text-zinc-600 font-bold px-4 leading-tight text-center">Chaque échéance devient une dépense automatiquement le jour venu, puis disparaît de la liste. D'ici là, seul le graphe anticipe le creux.</p>
                    {dueList(modal.data || {}).length > 0 && (
                      <button type="button" onClick={() => clearDueDate(modal.data.id)} className="w-full py-4 rounded-[2rem] font-black text-sm uppercase tracking-widest text-zinc-500 border border-white/10 hover:bg-white/5">Tout retirer</button>
                    )}
                  </div>
                ) : (modal.type === 'add_crypto' || modal.type === 'edit_crypto') ? (
                  <button type="button" onClick={handleCryptoSave} className="w-full py-6 rounded-[2rem] bg-orange-600 font-black text-xl uppercase shadow-xl">{modal.type === 'edit_crypto' ? 'Enregistrer' : 'Ajouter'}</button>
                ) : modal.type === 'realestate' ? (
                  <button type="button" onClick={handleRealEstateSave} className="w-full py-6 rounded-[2rem] bg-violet-600 font-black text-xl uppercase shadow-xl">Enregistrer</button>
                ) : (
                  <div className="flex flex-col gap-3">
                    <button type="submit" className={`w-full py-6 rounded-[2rem] font-black text-xl uppercase tracking-tighter shadow-xl transition-all ${modal.type === 'exceptional' && dueDraft.length > 0 ? 'bg-amber-600' : 'bg-emerald-600'}`}>{modal.type === 'exceptional' && dueDraft.length > 0 ? 'Programmer' : (modal.type === 'pending' && form.targetPending) ? "Ajouter à l'avance" : 'Confirmer'}</button>
                    {(modal.type === 'repay_partial' || modal.type === 'repay_savings_advance') && (
                      <button type="button" onClick={handleAbsorb} className="w-full py-4 rounded-[2rem] font-black text-sm uppercase tracking-widest text-amber-500 border border-amber-500/30 hover:bg-amber-500/10 flex items-center justify-center gap-2"><Flame size={16} /> Absorbé</button>
                    )}
                  </div>
                )}
              </form>
            </div>
          </div>
        )}
        {/* NAV BAR (Avec icones couleurs corrigées) */}
        <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 w-[95%] max-w-sm bg-zinc-900/80 backdrop-blur-3xl border border-white/10 px-6 py-5 rounded-[2.5rem] flex justify-between items-center z-50 shadow-2xl">
          <button onClick={() => setActiveTab('dashboard')} className={activeTab === 'dashboard' ? 'text-emerald-400 scale-125 transition-all' : 'text-zinc-600 transition-all'}><TrendingUp size={24} strokeWidth={3} /></button>
          <button onClick={() => setActiveTab('expenses')} className={activeTab === 'expenses' ? 'text-pink-300 scale-125 transition-all' : 'text-zinc-600 transition-all'}><Users size={24} strokeWidth={3} /></button>
          <button onClick={() => setActiveTab('personal')} className={activeTab === 'personal' ? 'text-rose-500 scale-125 transition-all' : 'text-zinc-600 transition-all'}><CheckSquare size={24} strokeWidth={3} /></button>
          <button onClick={() => setActiveTab('savings')} className={activeTab === 'savings' ? 'text-cyan-500 scale-125 transition-all' : 'text-zinc-600 transition-all'}><PiggyBank size={24} strokeWidth={3} /></button>
          <button onClick={() => setActiveTab('crypto')} className={activeTab === 'crypto' ? 'text-orange-400 scale-125 transition-all' : 'text-zinc-600 transition-all'}><Bitcoin size={24} strokeWidth={3} /></button>
          <button onClick={() => setActiveTab('realestate')} className={activeTab === 'realestate' ? 'text-violet-400 scale-125 transition-all' : 'text-zinc-600 transition-all'}><Building2 size={24} strokeWidth={3} /></button>
          <button onClick={() => setActiveTab('history')} className={activeTab === 'history' ? 'text-slate-200 scale-125 transition-all' : 'text-zinc-600 transition-all'}><HistoryIcon size={24} strokeWidth={3} /></button>
          <div className="w-px h-8 bg-white/10 mx-1" />
          <button onClick={handleLogout} className="text-zinc-600 hover:text-red-500 transition-colors"><LogOut size={22} /></button>
        </nav>
      </div>
    </div>
  );
}