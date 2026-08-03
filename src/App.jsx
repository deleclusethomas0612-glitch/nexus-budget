import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  TrendingUp, Users, Wallet, Plus, Check, X, Trash2, Pencil,
  History as HistoryIcon, Zap, HeartPulse,
  Receipt, ArrowDownLeft, ArrowUpRight, Home, Calendar, Coins, LogOut, Loader2, Flame,
  PiggyBank, CheckSquare, MessageSquare, Archive, GripVertical, LineChart, RefreshCw, Bitcoin
} from 'lucide-react';
import { supabase } from './supabase';
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
  return (
    <div
      onPointerDown={(e) => dragControls.start(e)}
      style={{ touchAction: 'none' }}
      className={`cursor-grab active:cursor-grabbing p-4 -mr-4 flex items-center justify-center z-20 ${className}`}
    >
      <GripVertical size={24} className="text-zinc-500 hover:text-white transition-colors" />
    </div>
  );
};

// Fonds du Plan d'Épargne BoursoBank : code Boursorama (OPCVM) + ISIN.
// Table extensible aux 6 autres fonds (Europe, France, Luxe, Santé, Tech, Climat).
const BOURSO_FUNDS = [
  { id: '0P0001US9F', name: 'Bourso Monde', isin: 'FR001400RWK6' },
  { id: '0P0001US9I', name: 'Bourso US', isin: 'FR001400RWL4' },
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

  const tabs = ['dashboard', 'expenses', 'personal', 'savings', 'crypto', 'history'];

  const handleTouchStart = (e) => {
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
    const totalAnnual = annualExpenses.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
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

    const accProvisionAt = (target) => annualExpenses.reduce(
      (acc, e) => acc + ((Number(e.amount) || 0) / 12) * monthsFor(e, target),
      0
    );

    const realCash = Math.round(
      startCash + accProvisionAt(absMonth(currentYear, currentMonthIndex)) + totalReimbursed - totalPaid - totalPending
    );

    const baseForProjection = startCash + totalReimbursed - totalPaid - totalPending;

    const projection = Array.from({ length: 12 }, (_, i) => ({
      name: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'][i],
      solde: Math.round(baseForProjection + accProvisionAt(absMonth(currentYear, i)))
    }));

    return { virement, realCash, projection, provision, totalFixed, totalAnnual, totalPending };
  }, [fixedExpenses, annualExpenses, reimbursements, exceptionalPaid, pending]);

  // --- 4. LOGIQUES INDÉPENDANTES ---
  // Prix d'une ligne de fonds : VL live si dispo, sinon dernière VL en cache.
  const fundPrice = (h) => (vlMap[h.fundId]?.vl ?? h.lastVL ?? 0);
  // Valeur d'un compte : portefeuille = Σ(parts × VL) arrondi à l'euro ; sinon solde saisi.
  const accountValue = (acc) => acc.isPortfolio
    ? Math.round((acc.holdings || []).reduce((s, h) => s + (Number(h.shares) || 0) * fundPrice(h), 0) + (Number(acc.cash) || 0))
    : (Number(acc.balance) || 0);

  const savingsTotal = useMemo(() => {
    return savingsAccounts.filter(a => a.kind !== 'crypto').reduce((sum, acc) => {
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
    draft._cash = (acc.cash != null && acc.cash !== 0) ? String(acc.cash) : '';
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
    setSavingsAccounts(savingsAccounts.map(a => a.id === acc.id ? { ...a, isPortfolio: true, holdings, cash: isFinite(cash) ? cash : 0 } : a));
    setModal({ open: false, type: '', data: null });
    setPortfolioDraft({});
    const syms = holdings.map(h => h.fundId);
    if (syms.length) fetchVLs(syms);
  };

  // --- CRYPTO (stocké dans savings_accounts avec kind:'crypto', affiché sur sa propre page) ---
  const cryptoAssets = savingsAccounts.filter(a => a.kind === 'crypto');
  const savingsView = savingsAccounts.filter(a => a.kind !== 'crypto');
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
    if (!form.targetAccount || isNaN(val) || !form.label) return;
    setSavingsPending([...savingsPending, { id: Date.now(), label: form.label, amount: val, targetAccountId: form.targetAccount }]);
    setSavingsAccounts(savingsAccounts.map(acc => {
      if (acc.id === form.targetAccount) return { ...acc, balance: acc.balance - val };
      return acc;
    }));
    setModal({ open: false, type: '', data: null });
    setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '', startDate: '' });
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
      setExceptionalPaid([...exceptionalPaid, { id: sharedId, label: debt.label, amount: debt.amount }]);
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
      setPending([{ id: sharedId, label: form.label, amount: val }, ...pending]);
    }
    else if (modal.type === 'exceptional') {
      setExceptionalPaid([{ id: sharedId, label: form.label, amount: val }, ...exceptionalPaid]);
      addEntry(sharedId, form.label, val, 'payment');
    }
    else if (modal.type === 'reimbursement') {
      setReimbursements([{ id: sharedId, label: form.label, amount: val }, ...reimbursements]);
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
  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-indigo-500"><Loader2 className="animate-spin" size={48} /></div>;

  if (!session) return (
    <div className="min-h-screen bg-[#020202] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <p className="text-zinc-500 text-xs font-bold uppercase tracking-[0.3em]">Cloud Access</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/10 rounded-[2.5rem] p-8 space-y-6 backdrop-blur-xl">
          <div className="flex gap-2 bg-black/50 p-1 rounded-2xl">
            <button onClick={() => setAuthMode('login')} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${authMode === 'login' ? 'bg-indigo-600 text-white' : 'text-zinc-600'}`}>Connexion</button>
            <button onClick={() => setAuthMode('signup')} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${authMode === 'signup' ? 'bg-indigo-600 text-white' : 'text-zinc-600'}`}>Créer</button>
          </div>
          {authError && <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl text-red-400 text-xs font-bold text-center">{authError}</div>}
          <form onSubmit={handleAuth} className="space-y-4">
            <input type="email" required placeholder="Email" className="w-full bg-black/50 border border-white/10 rounded-2xl p-5 outline-none focus:border-indigo-500 font-bold transition-all text-white" value={email} onChange={e => setEmail(e.target.value)} />
            <input type="password" required placeholder="Mot de passe" className="w-full bg-black/50 border border-white/10 rounded-2xl p-5 outline-none focus:border-indigo-500 font-bold transition-all text-white" value={password} onChange={e => setPassword(e.target.value)} />
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
      className="min-h-screen bg-[#020202] text-white font-sans antialiased pb-32 px-6 pt-6 selection:bg-indigo-500/30 overflow-x-hidden select-none"
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
              <div className="absolute -top-24 -right-24 w-64 h-64 bg-indigo-600/10 blur-[100px]" />
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
            <div className="h-44 w-full opacity-70 relative z-10">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={totals.projection}>
                  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.8} /><stop offset="95%" stopColor="#6366f1" stopOpacity={0.2} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff03" vertical={false} />
                  <XAxis dataKey="name" stroke="#3f3f46" fontSize={10} tickLine={false} axisLine={false} interval={0} padding={{ left: 10, right: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#09090b', border: 'none', borderRadius: '20px' }} itemStyle={{ color: '#818cf8' }} cursor={{ fill: '#ffffff05' }} />
                  <Bar dataKey="solde" fill="url(#g)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* QUICK ACTIONS */}
            <div className="grid grid-cols-3 gap-4">
              <button onClick={() => setModal({ open: true, type: 'exceptional' })} className="bg-zinc-900/50 border border-white/5 p-5 rounded-[2rem] flex flex-col items-center transition-all">
                <ArrowUpRight size={22} className="mb-2 text-red-500" /><span className="text-[8px] font-black uppercase text-zinc-500 text-center tracking-tighter leading-tight text-red-400">Dépenses</span>
              </button>
              <button onClick={() => setModal({ open: true, type: 'reimbursement' })} className="bg-emerald-500/10 border border-emerald-500/20 p-5 rounded-[2rem] flex flex-col items-center transition-all">
                <ArrowDownLeft size={22} className="mb-2 text-emerald-500" /><span className="text-[8px] font-black uppercase text-emerald-400 text-center tracking-tighter leading-tight text-emerald-400">Recette</span>
              </button>
              <button onClick={() => setModal({ open: true, type: 'pending' })} className="bg-white text-black p-5 rounded-[2rem] flex flex-col items-center transition-all">
                <Plus size={22} className="mb-2" /><span className="text-[8px] font-black uppercase text-center tracking-tighter leading-tight">Avance</span>
              </button>
            </div>

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
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
                        <div className="flex items-center gap-5">
                          <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center text-amber-500"><Coins size={22} /></div>
                          <div><p className="text-sm font-black italic uppercase text-left">{p.label}</p><p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest text-left">Gérer l'avance</p></div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-mono font-black text-amber-500 text-2xl">{p.amount}€</span>
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
              <button onClick={() => setModal({ open: true, type: 'savings_advance' })} className="bg-zinc-900 border border-white/10 py-4 rounded-2xl text-[10px] font-black uppercase text-zinc-400 hover:text-amber-500 transition-colors">Créer Avance</button>
            </div>

            {/* LISTE COMPTES */}
            <Reorder.Group axis="y" values={savingsView} onReorder={(newList) => setSavingsAccounts([...newList, ...cryptoAssets])} className="space-y-4">
              {savingsView.map(acc => (
                <DraggableItem key={acc.id} value={acc}>
                  <div className="bg-zinc-900/30 border border-white/5 p-4 rounded-[2.8rem] group active:scale-95 relative overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500" />
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
                            <button onClick={() => openPortfolio(acc)} className="text-zinc-600 hover:text-cyan-400" title="Gérer les parts"><Pencil size={13} /></button>
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
                          <div key={h.fundId} className="flex justify-between items-center text-[10px]">
                            <span className="font-bold text-zinc-400 uppercase">{fundName(h.fundId)}</span>
                            <span className="font-mono text-zinc-500">
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

            {/* COMPTE CRYPTO (lecture seule — total le plus récent, géré sur sa page dédiée) */}
            {cryptoAssets.length > 0 && (
              <div className="bg-zinc-900/30 border border-white/5 p-4 rounded-[2.8rem] relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500" />
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center text-orange-400"><Bitcoin size={20} strokeWidth={2.5} /></div>
                    <div>
                      <p className="text-sm font-black italic uppercase text-left text-zinc-200">Crypto</p>
                      <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest text-left">Géré sur la page dédiée</p>
                    </div>
                  </div>
                  <span className="text-xl font-black italic text-orange-500">{cryptoTotal.toLocaleString()}€</span>
                </div>
              </div>
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
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center text-amber-500"><Coins size={20} /></div>
                        <div>
                          <p className="text-sm font-black italic uppercase text-left text-amber-500">{p.label}</p>
                          <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest text-left">Vers: {targetName}</p>
                        </div>
                      </div>
                      <span className="text-xl font-black italic text-amber-500">{p.amount}€</span>
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
            <Reorder.Group axis="y" values={cryptoAssets} onReorder={(newList) => setSavingsAccounts([...savingsView, ...newList])} className="space-y-4">
              {cryptoAssets.length === 0 ? <p className="text-center text-zinc-700 italic text-[10px] py-4">Aucune crypto suivie. Ajoute-en une.</p> :
                cryptoAssets.map(a => (
                  <DraggableItem key={a.id} value={a}>
                    <div className="bg-zinc-900/30 border border-white/5 p-4 rounded-[2.8rem] flex justify-between items-center group active:scale-95 relative overflow-hidden">
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500" />
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

        {/* --- PAGE PERSO (AVEC TOTAL MENSUEL AJOUTÉ) --- */}
        {activeTab === 'personal' && (
          <div className="space-y-8 page-transition">
            {/* TOTAL FIXE MENSUEL */}
            <div className="bg-zinc-900/80 border border-white/10 rounded-[2.5rem] p-6 flex justify-between items-center relative overflow-hidden neon-pulse">
              <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/20 blur-xl"></div>
              <div>
                <p className="text-[10px] font-black uppercase text-indigo-500 tracking-widest">Total Mensuel Fixe</p>
                <p className="text-3xl font-black italic text-white">{personalTotal.toLocaleString()}€</p>
              </div>
            </div>

            <div className="flex justify-between items-center px-4 pt-4">
              <h2 className="text-2xl font-black italic tracking-tighter uppercase leading-none">Mes Charges</h2>
              <button onClick={() => setModal({ open: true, type: 'create_personal_expense' })} className="w-12 h-12 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-lg transition-all"><Plus size={24} /></button>
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
                        <span className={`text-xl font-black italic text-indigo-400`}>{item.amount}€</span>
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
              <button onClick={() => setModal({ open: true, type: 'expense' })} className="w-14 h-14 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-lg transition-all"><Plus size={28} /></button>
            </div>

            {/* TOTAL GLOBAL ET VIREMENT */}
            <div className="bg-zinc-900/80 border border-white/10 rounded-[2.5rem] p-6 flex justify-between items-center relative overflow-hidden neon-pulse">
              <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/20 blur-xl"></div>
              <div>
                <p className="text-[10px] font-black uppercase text-indigo-500 tracking-widest">Total Mensuel</p>
                <p className="text-3xl font-black italic text-white">{(totals.totalFixed + totals.provision).toLocaleString()}€</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black uppercase text-indigo-400 tracking-widest leading-none mb-1">Virement / P</p>
                <p className="text-2xl font-black italic text-indigo-400">{totals.virement.toLocaleString()}€</p>
              </div>
            </div>
            <section className="space-y-8">
              <div className="space-y-4">
                <div className="flex justify-between px-4 items-end">
                  <p className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.4em] italic leading-none">Mensuel Fixe</p>
                  <p className="text-xl font-black italic text-indigo-500 leading-none">{totals.totalFixed}€</p>
                </div>
                <Reorder.Group axis="y" values={fixedExpenses} onReorder={(newList) => setFixedExpenses(newList)} className="bg-zinc-900/20 border border-indigo-500/20 rounded-[3rem] p-2 space-y-2">
                  {fixedExpenses.map(e => (
                    <DraggableItem key={e.id} value={e}>
                      <div className="bg-zinc-900/30 border border-white/5 p-4 rounded-[2.8rem] flex justify-between items-center group active:scale-95 relative overflow-hidden">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500" />
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-400">{getIcon(e.name)}</div>
                          <div>
                            <p className="text-sm font-black italic uppercase text-left">{e.name}</p>
                            <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest text-left">Charge Fixe</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col items-end">
                            <span className="text-xl font-black italic text-indigo-400">{e.amount}€</span>
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
                  <p className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.4em] italic leading-none">Provisions Annuelles</p>
                  <p className="text-xl font-black italic text-emerald-500 leading-none">{totals.totalAnnual}€</p>
                </div>
                <Reorder.Group axis="y" values={annualExpenses} onReorder={(newList) => setAnnualExpenses(newList)} className="bg-zinc-900/20 border border-emerald-500/20 rounded-[3rem] p-2 space-y-2">
                  {annualExpenses.map(e => (
                    <DraggableItem key={e.id} value={e}>
                      <div className="bg-zinc-900/30 border border-white/5 p-4 rounded-[2.8rem] flex justify-between items-center group active:scale-95 relative overflow-hidden">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500" />
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-500"><Calendar size={18} /></div>
                          <div>
                            <p className="text-sm font-black italic uppercase text-left">{e.name}</p>
                            <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest text-left">{e.startDate ? `Dès ${new Date(e.startDate).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}` : 'Provision'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col items-end">
                            <span className="text-xl font-black italic text-emerald-500">{e.amount}€</span>
                            <div className="flex gap-2">
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
            <div className="bg-gradient-to-br from-zinc-900 to-indigo-900 rounded-[3.5rem] p-10 border border-white/5 shadow-2xl relative neon-pulse">
              <p className="text-indigo-200 text-[10px] font-black uppercase mb-1 italic">Journal des Flux</p>
              <h2 className="text-7xl font-black italic tracking-tighter leading-none">{history.filter(h => showArchives ? h.isArchived : !h.isArchived).length}</h2>
              <button onClick={() => setShowArchives(!showArchives)} className="absolute top-8 right-8 bg-black/20 p-3 rounded-2xl text-indigo-200 hover:bg-black/40 transition-all flex items-center gap-2">
                <Archive size={18} />
                <span className="text-[10px] font-bold uppercase">{showArchives ? "Actifs" : "Archives"}</span>
              </button>
            </div>
            <Reorder.Group axis="y" values={history} onReorder={(newList) => setHistory(newList)} className="space-y-4">
              {history.filter(h => showArchives ? h.isArchived : !h.isArchived).map(h => (
                <DraggableItem key={h.id} value={h}>
                  <div className={`bg-zinc-900/30 border border-white/5 p-6 rounded-[2.5rem] flex justify-between items-center relative group transition-all active:scale-95 ${h.isArchived ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className={`min-w-12 w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${h.type === 'payment' ? 'bg-red-500/10 text-red-500' : h.type === 'reimb' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-indigo-500/10 text-indigo-500'}`}>
                        {h.type === 'payment' ? <ArrowUpRight size={20} /> : h.type === 'reimb' ? <ArrowDownLeft size={20} /> : <HistoryIcon size={20} />}
                      </div>
                      <div className="flex flex-col gap-2 min-w-0 pr-2">
                        <div>
                          <p className="text-sm font-black italic uppercase truncate">{h.label}</p>
                          <p className="text-[8px] text-zinc-600 font-bold uppercase">{h.date}</p>
                        </div>
                        <div className="flex gap-2 items-center bg-black/20 p-2 w-max rounded-xl border border-white/5">
                          <button onClick={() => handleArchiveHistory(h)} className="text-zinc-500 hover:text-amber-500"><Archive size={16} /></button>
                          {!h.isArchived && <button onClick={() => handleEditHistory(h)} className="text-zinc-500 hover:text-indigo-400"><Pencil size={16} /></button>}
                          <button onClick={() => handleDeleteHistory(h)} className="text-zinc-500 hover:text-red-500"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 relative z-10">
                      <span className={`font-black italic text-xl ${h.type === 'payment' ? 'text-red-500' : h.type === 'reimb' ? 'text-emerald-500' : 'text-indigo-400'}`}>
                        {h.type === 'payment' ? '-' : '+'}{h.amount}€
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
            <div className="bg-zinc-900 border border-white/10 w-full max-w-md mx-auto rounded-[3.5rem] p-10 shadow-2xl animate-spring-in">
              <div className="flex justify-between items-center mb-10">
                <h2 className="text-2xl font-black italic uppercase text-white">
                  {modal.type === 'create_savings_account' ? 'Nouveau Compte' : modal.type === 'savings_transaction' ? 'Mouvement' : modal.type === 'savings_advance' ? 'Avance Épargne' : modal.type === 'create_personal_expense' ? 'Dépense Perso' : modal.type === 'portfolio' ? 'Portefeuille' : (modal.type === 'add_crypto' || modal.type === 'edit_crypto') ? 'Crypto' : 'Opération'}
                </h2>
                <button onClick={() => { setModal({ open: false, type: '', data: null }); setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '', startDate: '' }) }} className="text-zinc-600"><X size={28} /></button>
              </div>

              <form onSubmit={handleForm} className="space-y-8">
                {modal.type !== 'repay_partial' && modal.type !== 'repay_savings_advance' && modal.type !== 'savings_transaction' && modal.type !== 'portfolio' && modal.type !== 'add_crypto' && modal.type !== 'edit_crypto' && (
                  <div className="space-y-6">
                    {modal.type === 'expense' && (
                      <div className="flex gap-2 bg-black/50 p-1 rounded-2xl">
                        <button type="button" onClick={() => setForm({ ...form, cat: 'fixed' })} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${form.cat === 'fixed' ? 'bg-indigo-600 text-white' : 'text-zinc-600'}`}>Mensuel</button>
                        <button type="button" onClick={() => setForm({ ...form, cat: 'annual' })} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${form.cat === 'annual' ? 'bg-indigo-600 text-white' : 'text-zinc-600'}`}>Annuel</button>
                      </div>
                    )}
                    <input autoFocus className="w-full bg-black/50 border border-white/10 rounded-2xl p-6 outline-none focus:border-indigo-500 font-bold text-lg text-white" placeholder="Nom / Libellé" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
                    {modal.type === 'expense' && form.cat === 'annual' && (
                      <div className="space-y-2">
                        <p className="text-[10px] font-black uppercase text-emerald-500 pl-4">Date de démarrage (optionnel)</p>
                        <input type="date" className="w-full bg-black/50 border border-white/10 rounded-2xl p-5 outline-none focus:border-emerald-500 font-bold text-white [color-scheme:dark]" value={form.startDate || ''} onChange={e => setForm({ ...form, startDate: e.target.value })} />
                        <p className="text-[9px] text-zinc-600 font-bold pl-4 leading-tight">Sans date : cumul rétroactif depuis janvier. Avec date : cumul à partir du mois choisi.</p>
                      </div>
                    )}
                  </div>
                )}

                {(modal.type === 'savings_transaction' || modal.type === 'savings_advance') && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase text-zinc-500 pl-4">Compte Cible</p>
                    <div className="flex flex-wrap gap-2">
                      {savingsAccounts.map(acc => (
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
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-black italic uppercase text-zinc-200">{f.name}</span>
                            <span className="text-[10px] font-mono text-zinc-500">VL {vl ? vl.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '€' : (vlLoading ? '…' : '—')}</span>
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
                    <p className="text-[9px] text-zinc-600 font-bold pl-2 leading-tight">Valeur = (parts × VL) + liquidités, arrondie à l'euro. VL récupérée automatiquement sur Boursorama.</p>
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

                {modal.type !== 'portfolio' && modal.type !== 'add_crypto' && modal.type !== 'edit_crypto' && (
                  <div className="relative flex items-center gap-3">
                    <input type="number" step="0.01" className="w-full bg-black/50 border border-white/10 rounded-2xl p-6 outline-none focus:border-indigo-500 text-5xl font-black text-white text-center" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
                    {(modal.type === 'repay_partial' || modal.type === 'repay_savings_advance') && (
                      <button type="button" onClick={() => setForm({ ...form, amount: modal.data.amount })} className="px-4 py-8 bg-indigo-600/20 text-indigo-400 font-black uppercase text-xl rounded-2xl border border-indigo-500/20 hover:bg-indigo-600/40 transition-colors">MAX</button>
                    )}
                  </div>
                )}

                {modal.type === 'savings_transaction' ? (
                  <div className="flex gap-4">
                    <button type="button" onClick={() => handleSavingsTransaction(true)} className="flex-1 py-6 rounded-[2rem] bg-emerald-600 font-black text-xl uppercase shadow-xl">Dépot</button>
                    <button type="button" onClick={() => handleSavingsTransaction(false)} className="flex-1 py-6 rounded-[2rem] bg-red-600 font-black text-xl uppercase shadow-xl">Retrait</button>
                  </div>
                ) : modal.type === 'savings_advance' ? (
                  /* CORRECTION BOUTON "CRÉER AVANCE" */
                  <button type="button" onClick={handleSavingsAdvance} className="w-full py-6 rounded-[2rem] bg-cyan-600 font-black text-xl uppercase shadow-xl">Créer Avance</button>
                ) : modal.type === 'portfolio' ? (
                  <button type="button" onClick={handlePortfolioSave} className="w-full py-6 rounded-[2rem] bg-cyan-600 font-black text-xl uppercase shadow-xl">Enregistrer</button>
                ) : (modal.type === 'add_crypto' || modal.type === 'edit_crypto') ? (
                  <button type="button" onClick={handleCryptoSave} className="w-full py-6 rounded-[2rem] bg-orange-600 font-black text-xl uppercase shadow-xl">{modal.type === 'edit_crypto' ? 'Enregistrer' : 'Ajouter'}</button>
                ) : (
                  <div className="flex flex-col gap-3">
                    <button type="submit" className={`w-full py-6 rounded-[2rem] font-black text-xl uppercase tracking-tighter shadow-xl transition-all bg-indigo-600`}>Confirmer</button>
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
          <button onClick={() => setActiveTab('dashboard')} className={activeTab === 'dashboard' ? 'text-indigo-400 scale-125 transition-all' : 'text-zinc-600 transition-all'}><TrendingUp size={24} strokeWidth={3} /></button>
          <button onClick={() => setActiveTab('expenses')} className={activeTab === 'expenses' ? 'text-indigo-400 scale-125 transition-all' : 'text-zinc-600 transition-all'}><Users size={24} strokeWidth={3} /></button>
          <button onClick={() => setActiveTab('personal')} className={activeTab === 'personal' ? 'text-indigo-400 scale-125 transition-all' : 'text-zinc-600 transition-all'}><CheckSquare size={24} strokeWidth={3} /></button>
          <button onClick={() => setActiveTab('savings')} className={activeTab === 'savings' ? 'text-cyan-500 scale-125 transition-all' : 'text-zinc-600 transition-all'}><PiggyBank size={24} strokeWidth={3} /></button>
          <button onClick={() => setActiveTab('crypto')} className={activeTab === 'crypto' ? 'text-orange-400 scale-125 transition-all' : 'text-zinc-600 transition-all'}><Bitcoin size={24} strokeWidth={3} /></button>
          <button onClick={() => setActiveTab('history')} className={activeTab === 'history' ? 'text-indigo-400 scale-125 transition-all' : 'text-zinc-600 transition-all'}><HistoryIcon size={24} strokeWidth={3} /></button>
          <div className="w-px h-8 bg-white/10 mx-1" />
          <button onClick={handleLogout} className="text-zinc-600 hover:text-red-500 transition-colors"><LogOut size={22} /></button>
        </nav>
      </div>
    </div>
  );
}