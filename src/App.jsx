import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  TrendingUp, Users, Wallet, AlertCircle, Plus, Check, X, Trash2, Pencil,
  Banknote, ShieldCheck, History as HistoryIcon, Zap, HeartPulse,
  Receipt, ArrowDownLeft, ArrowUpRight, Home, Calendar, Coins, LogOut, Loader2, Flame,
  PiggyBank, CheckSquare, MessageSquare, Save, Archive
} from 'lucide-react';
import { supabase } from './supabase';

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
  const [form, setForm] = useState({ label: '', amount: '', cat: 'fixed', targetAccount: '' });
  const [showArchives, setShowArchives] = useState(false);
  const [touchStart, setTouchStart] = useState(null);

  const tabs = ['dashboard', 'expenses', 'personal', 'savings', 'history'];

  const handleTouchStart = (e) => setTouchStart(e.targetTouches[0].clientX);
  const handleTouchEnd = (e) => {
    if (!touchStart) return;
    const touchEnd = e.changedTouches[0].clientX;
    const diff = touchStart - touchEnd;
    const currentIndex = tabs.indexOf(activeTab);

    if (diff > 50 && currentIndex < tabs.length - 1) setActiveTab(tabs[currentIndex + 1]);
    if (diff < -50 && currentIndex > 0) setActiveTab(tabs[currentIndex - 1]);
    setTouchStart(null);
  };

  // --- 1. INITIALISATION CLOUD ---
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
  }, []);

  const fetchData = async (userId) => {
    setLoading(true);
    const { data, error } = await supabase.from('nexus_data').select('*').eq('user_id', userId).single();

    if (data) {
      setFixedExpenses(data.fixed_expenses || []);
      setAnnualExpenses(data.annual_expenses || []);
      setPending(data.pending || []);
      setHistory(data.history || []);
      setReimbursements(data.reimbursements || []);
      setExceptionalPaid(data.exceptional_paid || []);
      // Chargement V16
      setSavingsAccounts(data.savings_accounts || []);
      setSavingsPending(data.savings_pending || []);
      setPersonalExpenses(data.personal_expenses || []);
    } else if (!data && !error) {
      const defaults = {
        user_id: userId,
        fixed_expenses: [], annual_expenses: [], pending: [], history: [], reimbursements: [], exceptional_paid: [],
        savings_accounts: [], savings_pending: [], personal_expenses: []
      };
      await supabase.from('nexus_data').insert(defaults);
    }
    setLoading(false);
  };

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
    await supabase.from('nexus_data').upsert({ user_id: session.user.id, ...updates });
  };

  // Trigger sauvegarde auto
  useEffect(() => {
    if (!loading && session) saveData();
  }, [fixedExpenses, annualExpenses, pending, history, reimbursements, exceptionalPaid, savingsAccounts, savingsPending, personalExpenses]);

  // --- 2. AUTHENTIFICATION ---
  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true); setAuthError(null);
    let result;
    if (authMode === 'signup') result = await supabase.auth.signUp({ email, password });
    else result = await supabase.auth.signInWithPassword({ email, password });

    if (result.error) setAuthError(result.error.message);
    else if (authMode === 'signup') setAuthError("Vérifiez vos emails pour confirmer !");
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setFixedExpenses([]); setAnnualExpenses([]); setPending([]);
  };

  // --- 3. LOGIQUE MÉTIER ---
  const totals = useMemo(() => {
    const totalFixed = fixedExpenses.reduce((acc, c) => acc + c.amount, 0);
    const totalAnnual = annualExpenses.reduce((acc, c) => acc + c.amount, 0);
    const creche = fixedExpenses.find(e => e.name.toLowerCase().includes('crèche'))?.amount || 0;

    const provision = Math.round(totalAnnual / 12);
    const virement = Math.ceil((totalFixed - creche + provision) / 2);

    const totalPending = pending.reduce((acc, c) => acc + c.amount, 0);
    const totalReimbursed = reimbursements.reduce((acc, c) => acc + c.amount, 0);
    const totalPaid = exceptionalPaid.reduce((acc, c) => acc + c.amount, 0);

    const startCash = 1429;
    const currentMonthIndex = new Date().getMonth();

    const realCash = startCash
      + (provision * currentMonthIndex)
      + totalReimbursed - totalPaid - totalPending;

    const baseForProjection = startCash + totalReimbursed - totalPaid - totalPending;

    const projection = Array.from({ length: 12 }, (_, i) => ({
      name: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'][i],
      solde: Math.round(baseForProjection + (provision * i))
    }));

    return { virement, realCash, projection, provision, totalFixed, totalAnnual };
  }, [fixedExpenses, annualExpenses, reimbursements, exceptionalPaid, pending]);

  // --- 4. LOGIQUES INDÉPENDANTES ---
  const savingsTotal = useMemo(() => {
    return savingsAccounts.reduce((acc, c) => acc + c.balance, 0);
  }, [savingsAccounts]);

  const personalTotal = useMemo(() => {
    return personalExpenses.reduce((acc, c) => acc + c.amount, 0);
  }, [personalExpenses]);

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
    setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '' });
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
    setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '' });
  };

  const handleReimburseSavings = (debt) => {
    // Rendue obsolète par le nouveau flux de modale pour le remboursement
    // Conservée pour éviter de casser des dépendances invisibles, mais plus appelée directement depuis le onClick.
    setSavingsPending(savingsPending.filter(p => p.id !== debt.id));
    setSavingsAccounts(savingsAccounts.map(acc => {
      if (acc.id === debt.targetAccountId) return { ...acc, balance: acc.balance + debt.amount };
      return acc;
    }));
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
    const n = name.toLowerCase();
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
      setPersonalExpenses([...personalExpenses, { id: Date.now(), label: form.label, amount: val, isPaid: false, comment: '' }]);
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
      const item = { id: sharedId, name: form.label, amount: val };
      if (form.cat === 'fixed') setFixedExpenses([...fixedExpenses, item]);
      else setAnnualExpenses([...annualExpenses, item]);
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
    setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '' });
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
      className="min-h-screen bg-[#020202] text-white font-sans antialiased pb-44 px-6 pt-6 selection:bg-indigo-500/30 overflow-x-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="max-w-md mx-auto space-y-6">

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
                {/* Virement déplacé sur Charges Fixes */}
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
              <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.4em] px-4 italic">Flux</h3>
              <div className="space-y-4">
                {pending.length === 0 ? <p className="text-center text-zinc-700 italic text-[10px] py-4">Aucune avance active.</p> :
                  pending.map(p => (
                    <button key={p.id} onClick={() => setModal({ open: true, type: 'repay_partial', data: p })} className="w-full bg-zinc-900/30 border border-white/5 p-6 rounded-[2.8rem] flex justify-between items-center transition-all group relative overflow-hidden">
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
                      <div className="flex items-center gap-5">
                        <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center text-amber-500"><Coins size={22} /></div>
                        <div><p className="text-sm font-black italic uppercase text-left">{p.label}</p><p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest text-left">Gérer l'avance</p></div>
                      </div>
                      <span className="font-mono font-black text-amber-500 text-2xl">{p.amount}€</span>
                    </button>
                  ))}
              </div>
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
                  <h2 className="text-5xl font-black tracking-tighter italic text-cyan-100">{savingsTotal.toLocaleString()}€</h2>
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
            <div className="space-y-4">
              {savingsAccounts.map(acc => (
                <div key={acc.id} className="bg-zinc-900/60 border border-white/5 p-6 rounded-[2.5rem] flex justify-between items-center group relative overflow-hidden">
                  <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-black via-transparent to-transparent opacity-50" />
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-zinc-200 uppercase">{acc.name}</span>
                    <span className="text-[10px] text-zinc-600 font-black uppercase">Disponible</span>
                  </div>
                  <div className="flex items-center gap-4 z-10">
                    <span className="text-2xl font-black italic text-cyan-500">{acc.balance}€</span>
                    <button onClick={() => { if (window.confirm('Supprimer ce compte épargne ?')) setSavingsAccounts(savingsAccounts.filter(a => a.id !== acc.id)) }} className="text-zinc-700 hover:text-red-500"><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
            </div>

            {/* AVANCE SUR EPARGNE (RENOMMÉ) */}
            {savingsPending.length > 0 && (
              <section className="space-y-4 pt-4 border-t border-white/5">
                <h3 className="text-[10px] font-black text-amber-700 uppercase tracking-widest px-2">Avance sur Épargne</h3>
                {savingsPending.map(p => {
                  const targetName = savingsAccounts.find(a => a.id === p.targetAccountId)?.name || 'Compte supprimé';
                  return (
                    <div key={p.id} onClick={() => { setForm({ amount: '' }); setModal({ open: true, type: 'repay_savings_advance', data: p }) }} className="bg-amber-900/10 border border-amber-900/30 p-5 rounded-[2rem] flex justify-between items-center cursor-pointer hover:bg-amber-900/20 transition-all">
                      <div>
                        <p className="text-xs font-bold text-amber-500 uppercase">{p.label}</p>
                        <p className="text-[8px] text-zinc-500 font-bold uppercase">Vers: {targetName}</p>
                      </div>
                      <span className="text-xl font-black text-amber-600">{p.amount}€</span>
                    </div>
                  )
                })}
              </section>
            )}
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

            <div className="space-y-3">
              {personalExpenses.map(item => (
                <div key={item.id} className={`p-6 rounded-[2.5rem] border transition-all ${item.isPaid ? 'bg-emerald-900/10 border-emerald-500/20 opacity-60' : 'bg-zinc-900/60 border-white/5'}`}>
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-4">
                      <button onClick={() => togglePersonalPaid(item.id)} className={`w-8 h-8 rounded-xl flex items-center justify-center border transition-all ${item.isPaid ? 'bg-emerald-500 border-emerald-500 text-black' : 'border-zinc-700 text-transparent hover:border-emerald-500'}`}>
                        <Check size={16} strokeWidth={4} />
                      </button>
                      <div>
                        <p className={`text-sm font-black uppercase ${item.isPaid ? 'text-emerald-500 line-through' : 'text-zinc-200'}`}>{item.label}</p>
                        <p className="text-lg font-black italic text-indigo-400">{item.amount}€</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={() => { setForm({ label: item.label, amount: item.amount }); setModal({ open: true, type: 'create_personal_expense' }); setPersonalExpenses(personalExpenses.filter(i => i.id !== item.id)) }} className="text-zinc-600 hover:text-white"><Pencil size={16} /></button>
                      <button onClick={() => { if (window.confirm('Supprimer ?')) setPersonalExpenses(personalExpenses.filter(i => i.id !== item.id)) }} className="text-zinc-600 hover:text-red-500"><Trash2 size={16} /></button>
                    </div>
                  </div>
                  {item.label.toLowerCase().includes('essence') && (
                    <div className="flex items-center gap-2 mt-2 bg-black/30 p-2 rounded-xl border border-white/5">
                      <MessageSquare size={14} className="text-zinc-500" />
                      <input
                        type="text"
                        placeholder="Km / Trajet..."
                        className="bg-transparent w-full text-xs font-bold text-zinc-300 outline-none placeholder:text-zinc-700"
                        value={item.comment || ''}
                        onChange={(e) => updatePersonalComment(item.id, e.target.value)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- PAGE CHARGES FIXES --- */}
        {activeTab === 'expenses' && (
          <div className="space-y-10 pb-20 text-white page-transition">
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
                <div className="bg-zinc-900/20 border border-indigo-500/20 rounded-[3rem] p-2 space-y-2">
                  {fixedExpenses.map(e => (
                    <div key={e.id} className="bg-zinc-900/60 border border-white/5 p-6 rounded-[2.5rem] flex flex-col justify-between group">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-4 text-indigo-400">{getIcon(e.name)}<span className="text-sm font-bold text-zinc-200">{e.name}</span></div>
                        <div className="flex items-center gap-5 text-indigo-400 font-black italic">{e.amount}€</div>
                      </div>
                      <div className="flex gap-3 justify-end mt-4">
                        <button onClick={() => { setForm({ label: e.name, amount: e.amount, cat: 'fixed' }); setModal({ open: true, type: 'expense' }); setFixedExpenses(fixedExpenses.filter(x => x.id !== e.id)) }} className="text-zinc-600 hover:text-white"><Pencil size={16} /></button>
                        <button onClick={() => { const n = fixedExpenses.filter(x => x.id !== e.id); setFixedExpenses(n); }} className="text-zinc-600 hover:text-red-500"><Trash2 size={16} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between px-4 items-end">
                  <p className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.4em] italic leading-none">Provisions Annuelles</p>
                  <p className="text-xl font-black italic text-emerald-500 leading-none">{totals.totalAnnual}€</p>
                </div>
                <div className="bg-zinc-900/20 border border-emerald-500/20 rounded-[3rem] p-2 space-y-2">
                  {annualExpenses.map(e => (
                    <div key={e.id} className="bg-zinc-900/60 border border-white/5 p-6 rounded-[2.5rem] flex flex-col justify-between group">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-4 text-emerald-500"><Calendar size={18} /><span className="text-sm font-bold text-zinc-200">{e.name}</span></div>
                        <div className="flex items-center gap-5 text-emerald-500 font-black italic">{e.amount}€</div>
                      </div>
                      <div className="flex gap-3 justify-end mt-4">
                        <button onClick={() => { setForm({ label: e.name, amount: e.amount, cat: 'annual' }); setModal({ open: true, type: 'expense' }); setAnnualExpenses(annualExpenses.filter(x => x.id !== e.id)); }} className="text-zinc-600 hover:text-white"><Pencil size={16} /></button>
                        <button onClick={() => { const n = annualExpenses.filter(x => x.id !== e.id); setAnnualExpenses(n); }} className="text-zinc-600 hover:text-red-500"><Trash2 size={16} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}

        {/* --- HISTORIQUE --- */}
        {activeTab === 'history' && (
          <div className="space-y-8 pb-20 page-transition">
            <div className="bg-gradient-to-br from-zinc-900 to-indigo-900 rounded-[3.5rem] p-10 border border-white/5 shadow-2xl relative neon-pulse">
              <p className="text-indigo-200 text-[10px] font-black uppercase mb-1 italic">Journal des Flux</p>
              <h2 className="text-7xl font-black italic tracking-tighter leading-none">{history.filter(h => showArchives ? h.isArchived : !h.isArchived).length}</h2>
              <button onClick={() => setShowArchives(!showArchives)} className="absolute top-8 right-8 bg-black/20 p-3 rounded-2xl text-indigo-200 hover:bg-black/40 transition-all flex items-center gap-2">
                <Archive size={18} />
                <span className="text-[10px] font-bold uppercase">{showArchives ? "Actifs" : "Archives"}</span>
              </button>
            </div>
            <div className="space-y-4">
              {history.filter(h => showArchives ? h.isArchived : !h.isArchived).map(h => (
                <div key={h.id} className={`bg-zinc-900/30 border border-white/5 p-6 rounded-[2.5rem] flex justify-between items-center relative group transition-all ${h.isArchived ? 'opacity-50' : ''}`}>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-3 pl-4 bg-zinc-900/90 py-2 rounded-xl">
                    <button onClick={() => handleArchiveHistory(h)} className="text-zinc-500 hover:text-amber-500"><Archive size={16} /></button>
                    {!h.isArchived && <button onClick={() => handleEditHistory(h)} className="text-zinc-500 hover:text-indigo-400"><Pencil size={16} /></button>}
                    <button onClick={() => handleDeleteHistory(h)} className="text-zinc-500 hover:text-red-500"><Trash2 size={16} /></button>
                  </div>
                  <div className="flex items-center gap-5">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${h.type === 'payment' ? 'bg-red-500/10 text-red-500' : h.type === 'reimb' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-indigo-500/10 text-indigo-500'}`}>
                      {h.type === 'payment' ? <ArrowUpRight size={20} /> : h.type === 'reimb' ? <ArrowDownLeft size={20} /> : <HistoryIcon size={20} />}
                    </div>
                    <div className="pr-20"><p className="text-sm font-black italic uppercase truncate max-w-[120px]">{h.label}</p><p className="text-[8px] text-zinc-600 font-bold uppercase">{h.date}</p></div>
                  </div>
                  <span className={`font-black italic text-xl absolute right-24 top-1/2 -translate-y-1/2 ${h.type === 'payment' ? 'text-red-500' : h.type === 'reimb' ? 'text-emerald-500' : 'text-indigo-400'}`}>
                    {h.type === 'payment' ? '-' : '+'}{h.amount}€
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* --- MODAL --- */}
        {modal.open && (
          <div className="fixed inset-0 bg-black/95 backdrop-blur-3xl z-[200] flex items-end p-6 animate-in fade-in duration-300">
            <div className="bg-zinc-900 border border-white/10 w-full max-w-md mx-auto rounded-[3.5rem] p-10 shadow-2xl animate-spring-in">
              <div className="flex justify-between items-center mb-10">
                <h2 className="text-2xl font-black italic uppercase text-white">
                  {modal.type === 'create_savings_account' ? 'Nouveau Compte' : modal.type === 'savings_transaction' ? 'Mouvement' : modal.type === 'savings_advance' ? 'Avance Épargne' : modal.type === 'create_personal_expense' ? 'Dépense Perso' : 'Opération'}
                </h2>
                <button onClick={() => { setModal({ open: false, type: '', data: null }); setForm({ label: '', amount: '', cat: 'fixed', targetAccount: '' }) }} className="text-zinc-600"><X size={28} /></button>
              </div>

              <form onSubmit={handleForm} className="space-y-8">
                {modal.type !== 'repay_partial' && modal.type !== 'repay_savings_advance' && modal.type !== 'savings_transaction' && (
                  <div className="space-y-6">
                    {modal.type === 'expense' && (
                      <div className="flex gap-2 bg-black/50 p-1 rounded-2xl">
                        <button type="button" onClick={() => setForm({ ...form, cat: 'fixed' })} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${form.cat === 'fixed' ? 'bg-indigo-600 text-white' : 'text-zinc-600'}`}>Mensuel</button>
                        <button type="button" onClick={() => setForm({ ...form, cat: 'annual' })} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${form.cat === 'annual' ? 'bg-indigo-600 text-white' : 'text-zinc-600'}`}>Annuel</button>
                      </div>
                    )}
                    <input autoFocus className="w-full bg-black/50 border border-white/10 rounded-2xl p-6 outline-none focus:border-indigo-500 font-bold text-lg text-white" placeholder="Nom / Libellé" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
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

                <div className="relative flex items-center gap-3">
                  <input type="number" step="0.01" className="w-full bg-black/50 border border-white/10 rounded-2xl p-6 outline-none focus:border-indigo-500 text-5xl font-black text-white text-center" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
                  {(modal.type === 'repay_partial' || modal.type === 'repay_savings_advance') && (
                    <button type="button" onClick={() => setForm({ ...form, amount: modal.data.amount })} className="px-4 py-8 bg-indigo-600/20 text-indigo-400 font-black uppercase text-xl rounded-2xl border border-indigo-500/20 hover:bg-indigo-600/40 transition-colors">MAX</button>
                  )}
                </div>

                {modal.type === 'savings_transaction' ? (
                  <div className="flex gap-4">
                    <button type="button" onClick={() => handleSavingsTransaction(true)} className="flex-1 py-6 rounded-[2rem] bg-emerald-600 font-black text-xl uppercase shadow-xl">Dépot</button>
                    <button type="button" onClick={() => handleSavingsTransaction(false)} className="flex-1 py-6 rounded-[2rem] bg-red-600 font-black text-xl uppercase shadow-xl">Retrait</button>
                  </div>
                ) : modal.type === 'savings_advance' ? (
                  /* CORRECTION BOUTON "CRÉER AVANCE" */
                  <button type="button" onClick={handleSavingsAdvance} className="w-full py-6 rounded-[2rem] bg-cyan-600 font-black text-xl uppercase shadow-xl">Créer Avance</button>
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
          <button onClick={() => setActiveTab('history')} className={activeTab === 'history' ? 'text-indigo-400 scale-125 transition-all' : 'text-zinc-600 transition-all'}><HistoryIcon size={24} strokeWidth={3} /></button>
          <div className="w-px h-8 bg-white/10 mx-1" />
          <button onClick={handleLogout} className="text-zinc-600 hover:text-red-500 transition-colors"><LogOut size={22} /></button>
        </nav>
      </div>
    </div>
  );
}