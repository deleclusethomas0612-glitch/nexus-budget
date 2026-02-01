import React, { useState, useMemo, useEffect } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { 
  TrendingUp, Users, Wallet, AlertCircle, Plus, Check, X, Trash2, Pencil,
  Banknote, ShieldCheck, History as HistoryIcon, Zap, HeartPulse, 
  Receipt, ArrowDownLeft, ArrowUpRight, Home, Calendar, Coins, LogOut, Loader2, Flame
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

  // --- DATA STATE ---
  const [fixedExpenses, setFixedExpenses] = useState([]);
  const [annualExpenses, setAnnualExpenses] = useState([]);
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [reimbursements, setReimbursements] = useState([]);
  const [exceptionalPaid, setExceptionalPaid] = useState([]);

  // --- UI STATE ---
  const [activeTab, setActiveTab] = useState('dashboard');
  const [modal, setModal] = useState({ open: false, type: '', data: null });
  const [form, setForm] = useState({ label: '', amount: '', cat: 'fixed' });

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
    } else if (!data && !error) {
      const defaults = {
        user_id: userId,
        fixed_expenses: [
          { id: 1, name: 'Crédit Immo', amount: 1250 },
          { id: 2, name: 'Charges Copro', amount: 260 },
          { id: 4, name: 'Crèche', amount: 1281.83 },
        ],
        annual_expenses: [
          { id: 101, name: 'Taxe Foncière', amount: 2700 },
          { id: 102, name: 'Assurances/Divers', amount: 1848 },
        ],
        pending: [{ id: 1, label: 'Dépenses 2025', amount: 155 }],
        history: [], reimbursements: [], exceptional_paid: []
      };
      await supabase.from('nexus_data').insert(defaults);
      setFixedExpenses(defaults.fixed_expenses);
      setAnnualExpenses(defaults.annual_expenses);
      setPending(defaults.pending);
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
      exceptional_paid: exceptionalPaid
    };
    await supabase.from('nexus_data').upsert({ user_id: session.user.id, ...updates });
  };

  useEffect(() => { 
    if (!loading && session) saveData(); 
  }, [fixedExpenses, annualExpenses, pending, history, reimbursements, exceptionalPaid]);

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

    // Calcul Temporel
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

  // Fonction utilitaire pour synchroniser l'historique et les données
  const addEntry = (id, label, amount, type) => {
    const newLog = { 
        id: id, // ID partagé crucial pour la suppression
        label, 
        amount, 
        type, 
        date: new Date().toLocaleDateString('fr-FR', {day:'2-digit', month:'short'}) 
    };
    setHistory([newLog, ...history]);
  };

  const getIcon = (name) => {
    const n = name.toLowerCase();
    if (n.includes('crédit') || n.includes('immo')) return <Home size={18}/>;
    if (n.includes('charges') || n.includes('engie') || n.includes('eau')) return <Zap size={18}/>;
    if (n.includes('crèche') || n.includes('santé')) return <HeartPulse size={18}/>;
    return <Receipt size={18}/>;
  };

  const handleAbsorb = () => {
    const debt = modal.data;
    const sharedId = Date.now();
    setPending(pending.filter(p => p.id !== debt.id));
    setExceptionalPaid([...exceptionalPaid, { id: sharedId, label: debt.label, amount: debt.amount }]);
    addEntry(sharedId, `Absorbé: ${debt.label}`, debt.amount, 'payment');
    setModal({ open: false, type: '', data: null });
    setForm({ label: '', amount: '', cat: 'fixed' });
  };

  // --- GESTION HISTORIQUE (Suppression & Modif) ---
  const handleDeleteHistory = (item) => {
    if(!window.confirm("Supprimer cette écriture et mettre à jour le solde ?")) return;
    
    // 1. Supprimer de l'historique visuel
    setHistory(history.filter(h => h.id !== item.id));

    // 2. Supprimer l'impact financier réel (si trouvé)
    if (item.type === 'payment') {
        setExceptionalPaid(exceptionalPaid.filter(p => p.id !== item.id));
    } else if (item.type === 'reimb') {
        setReimbursements(reimbursements.filter(r => r.id !== item.id));
    }
  };

  const handleEditHistory = (item) => {
    setForm({ label: item.label, amount: item.amount, cat: 'fixed' });
    setModal({ open: true, type: 'edit_history', data: item });
  };

  const handleForm = (e) => {
    e.preventDefault();
    const val = parseFloat(form.amount);
    if (isNaN(val) || val <= 0) return;
    const sharedId = Date.now(); // ID Unique pour lier Log et Donnée

    if (modal.type === 'edit_history') {
        const oldItem = modal.data;
        // Mise à jour de l'historique
        setHistory(history.map(h => h.id === oldItem.id ? { ...h, label: form.label, amount: val } : h));
        
        // Mise à jour des données financières
        if (oldItem.type === 'payment') {
            setExceptionalPaid(exceptionalPaid.map(p => p.id === oldItem.id ? { ...p, label: form.label, amount: val } : p));
        } else if (oldItem.type === 'reimb') {
            setReimbursements(reimbursements.map(r => r.id === oldItem.id ? { ...r, label: form.label, amount: val } : r));
        }
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
      if(form.cat === 'fixed') setFixedExpenses([...fixedExpenses, item]);
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
    setModal({ open: false, type: '', data: null });
    setForm({ label: '', amount: '', cat: 'fixed' });
  };

  // --- 4. RENDER ---
  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-indigo-500"><Loader2 className="animate-spin" size={48} /></div>;

  if (!session) return (
    <div className="min-h-screen bg-[#020202] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
           <h1 className="text-5xl font-black italic tracking-tighter uppercase mb-2">NEXUS<span className="text-indigo-500">.</span></h1>
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
    <div className="min-h-screen bg-[#020202] text-white font-sans antialiased pb-44 px-6 pt-14 selection:bg-indigo-500/30">
      <div className="max-w-md mx-auto space-y-10">
        
        {/* HEADER */}
        <header className="flex justify-between items-center px-2">
          <div className="relative">
            <h1 className="text-4xl font-black italic tracking-tighter uppercase leading-none">NEXUS<span className="text-indigo-500">.</span></h1>
            <div className="absolute -bottom-2 left-0 w-12 h-1 bg-indigo-500 rounded-full blur-[2px]" />
          </div>
          <button onClick={handleLogout} className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center text-zinc-500 hover:text-red-500 transition-colors shadow-2xl active:scale-90"><LogOut size={20} /></button>
        </header>

        {activeTab === 'dashboard' && (
          <div className="space-y-10 animate-in fade-in duration-700">
            {/* CARTE SOLDE (RENOMMÉE CASH DISPO) */}
            <div className="bg-zinc-900/40 border border-white/10 rounded-[3rem] p-9 relative overflow-hidden backdrop-blur-xl shadow-2xl">
              <div className="absolute -top-24 -right-24 w-64 h-64 bg-indigo-600/10 blur-[100px]" />
              <div className="flex justify-between items-start mb-8 relative z-10">
                <div>
                  <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest italic mb-1">Cash Dispo</p>
                  <h2 className="text-6xl font-black tracking-tighter italic">{totals.realCash.toLocaleString()}€</h2>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black text-indigo-400 uppercase italic leading-none mb-1">Virement / P</p>
                  <p className="text-3xl font-black italic text-indigo-400 leading-none">{totals.virement}€</p>
                </div>
              </div>
              <div className="h-44 w-full opacity-70 relative z-10">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={totals.projection}>
                    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.4}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff03" vertical={false} />
                    {/* XAxis Corrigé : Interval 0 pour forcer affichage, padding pour les bords */}
                    <XAxis 
                        dataKey="name" 
                        stroke="#3f3f46" 
                        fontSize={10} 
                        tickLine={false} 
                        axisLine={false} 
                        interval={0} 
                        padding={{ left: 10, right: 10 }}
                    />
                    <Tooltip contentStyle={{ backgroundColor: '#09090b', border: 'none', borderRadius: '20px' }} itemStyle={{color:'#818cf8'}} />
                    <Area type="monotone" dataKey="solde" stroke="#6366f1" fill="url(#g)" strokeWidth={4} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* QUICK ACTIONS (RENOMMÉES) */}
            <div className="grid grid-cols-3 gap-4">
               <button onClick={() => setModal({open:true, type:'exceptional'})} className="bg-zinc-900/50 border border-white/5 p-5 rounded-[2rem] flex flex-col items-center active:scale-95 transition-all">
                  <ArrowUpRight size={22} className="mb-2 text-red-500" /><span className="text-[8px] font-black uppercase text-zinc-500 text-center tracking-tighter leading-tight text-red-400">Dépenses</span>
               </button>
               <button onClick={() => setModal({open:true, type:'reimbursement'})} className="bg-emerald-500/10 border border-emerald-500/20 p-5 rounded-[2rem] flex flex-col items-center active:scale-95 transition-all">
                  <ArrowDownLeft size={22} className="mb-2 text-emerald-500" /><span className="text-[8px] font-black uppercase text-emerald-400 text-center tracking-tighter leading-tight text-emerald-400">Recette</span>
               </button>
               <button onClick={() => setModal({open:true, type:'pending'})} className="bg-white text-black p-5 rounded-[2rem] flex flex-col items-center active:scale-95 transition-all">
                  <Plus size={22} className="mb-2" /><span className="text-[8px] font-black uppercase text-center tracking-tighter leading-tight">Avance</span>
               </button>
            </div>

            {/* FLUX (RENOMMÉ) */}
            <section className="space-y-5">
              <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.4em] px-4 italic">Flux</h3>
              <div className="space-y-4">
                {pending.length === 0 ? <p className="text-center text-zinc-700 italic text-[10px] py-4">Aucune avance active.</p> : 
                pending.map(p => (
                  <button key={p.id} onClick={() => setModal({open:true, type:'repay_partial', data:p})} className="w-full bg-zinc-900/30 border border-white/5 p-6 rounded-[2.8rem] flex justify-between items-center active:scale-[0.98] transition-all group relative overflow-hidden">
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

        {activeTab === 'expenses' && (
          <div className="space-y-10 pb-20 text-white animate-in slide-in-from-right-10 duration-500">
             <div className="flex justify-between items-center px-4">
                <h2 className="text-3xl font-black italic tracking-tighter uppercase leading-none">Charges Fixes</h2>
                <button onClick={() => setModal({open:true, type:'expense'})} className="w-14 h-14 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-lg active:scale-90 transition-all"><Plus size={28}/></button>
             </div>
             
             <section className="space-y-8">
                <div className="space-y-4">
                  <div className="flex justify-between px-4 items-end">
                    <p className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.4em] italic leading-none">Mensuel Fixe</p>
                    <p className="text-xl font-black italic text-indigo-500 leading-none">{totals.totalFixed}€</p>
                  </div>
                  <div className="bg-zinc-900/20 border border-indigo-500/20 rounded-[3rem] p-2 space-y-2">
                    {fixedExpenses.map(e => (
                      <div key={e.id} className="bg-zinc-900/60 border border-white/5 p-6 rounded-[2.5rem] flex justify-between items-center group">
                          <div className="flex items-center gap-4 text-indigo-400">{getIcon(e.name)}<span className="text-sm font-bold text-zinc-200">{e.name}</span></div>
                          <div className="flex items-center gap-5 text-indigo-400 font-black italic">{e.amount}€<Trash2 size={18} className="text-zinc-800 hover:text-red-500 cursor-pointer" onClick={() => { const n = fixedExpenses.filter(x => x.id !== e.id); setFixedExpenses(n); }} /></div>
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
                      <div key={e.id} className="bg-zinc-900/60 border border-white/5 p-6 rounded-[2.5rem] flex justify-between items-center group">
                          <div className="flex items-center gap-4 text-emerald-500"><Calendar size={18}/><span className="text-sm font-bold text-zinc-200">{e.name}</span></div>
                          <div className="flex items-center gap-5 text-emerald-500 font-black italic">{e.amount}€<Trash2 size={18} className="text-zinc-800 hover:text-red-500 cursor-pointer" onClick={() => { const n = annualExpenses.filter(x => x.id !== e.id); setAnnualExpenses(n); }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
             </section>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-8 pb-20 animate-in slide-in-from-left-10 duration-500">
             <div className="bg-gradient-to-br from-zinc-900 to-indigo-900 rounded-[3.5rem] p-10 border border-white/5 shadow-2xl">
                <p className="text-indigo-200 text-[10px] font-black uppercase mb-1 italic">Journal des Flux</p>
                <h2 className="text-7xl font-black italic tracking-tighter leading-none">{history.length}</h2>
             </div>
             <div className="space-y-4">
                {history.length === 0 && <p className="text-center text-zinc-700 italic text-sm">Aucun historique récent.</p>}
                {history.map(h => (
                  <div key={h.id} className="bg-zinc-900/30 border border-white/5 p-6 rounded-[2.5rem] flex justify-between items-center relative group">
                     {/* BOUTONS ACTIONS (Cachés par défaut, visibles au besoin ou toujours) */}
                     <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-3 pl-4 bg-zinc-900/90 py-2 rounded-xl">
                        <button onClick={() => handleEditHistory(h)} className="text-zinc-500 hover:text-indigo-400"><Pencil size={16} /></button>
                        <button onClick={() => handleDeleteHistory(h)} className="text-zinc-500 hover:text-red-500"><Trash2 size={16} /></button>
                     </div>

                     <div className="flex items-center gap-5">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${h.type === 'payment' ? 'bg-red-500/10 text-red-500' : h.type === 'reimb' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-indigo-500/10 text-indigo-500'}`}>
                           {h.type === 'payment' ? <ArrowUpRight size={20}/> : h.type === 'reimb' ? <ArrowDownLeft size={20}/> : <HistoryIcon size={20}/>}
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
      </div>

      {modal.open && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-3xl z-[200] flex items-end p-6">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-md mx-auto rounded-[3.5rem] p-10 shadow-2xl">
            <div className="flex justify-between items-center mb-10">
              <h2 className={`text-2xl font-black italic uppercase ${modal.type === 'reimbursement' ? 'text-emerald-400' : modal.type === 'exceptional' ? 'text-red-400' : 'text-white'}`}>
                {modal.type === 'repay_partial' ? 'Rembourser' : modal.type === 'pending' ? 'Avance' : modal.type === 'exceptional' ? 'Dépense' : modal.type === 'edit_history' ? 'Modifier' : modal.type === 'reimbursement' ? 'Recette' : 'Charge'}
              </h2>
              <button onClick={() => setModal({open:false, type:'', data:null})} className="text-zinc-600"><X size={28}/></button>
            </div>
            
            {modal.type === 'expense' && (
              <div className="flex gap-2 p-1 bg-black rounded-2xl mb-8 border border-white/5">
                <button onClick={() => setForm({...form, cat: 'fixed'})} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${form.cat === 'fixed' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-600'}`}>Mensuelle</button>
                <button onClick={() => setForm({...form, cat: 'annual'})} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${form.cat === 'annual' ? 'bg-emerald-600 text-white shadow-lg' : 'text-zinc-600'}`}>Annuelle</button>
              </div>
            )}

            <form onSubmit={handleForm} className="space-y-8">
               {/* INPUT LIBELLÉ (Masqué pour gestion dette) */}
               {modal.type !== 'repay_partial' && (
                 <input autoFocus className="w-full bg-black/50 border border-white/10 rounded-2xl p-6 outline-none focus:border-indigo-500 font-bold text-lg text-white" placeholder="Libellé" value={form.label} onChange={e => setForm({...form, label: e.target.value})} />
               )}

               {/* INFO DETTE RESTANTE */}
               {modal.type === 'repay_partial' && (
                 <div className="text-center p-6 bg-amber-500/10 rounded-3xl mb-4 border border-amber-500/20">
                    <p className="text-[10px] font-black uppercase text-amber-500 mb-1 italic">Reste dû: {modal.data?.label}</p>
                    <p className="text-4xl font-black text-amber-500 italic">{modal.data?.amount}€</p>
                 </div>
               )}

               {/* INPUT MONTANT + BOUTON MAX */}
               <div className="relative">
                  <input autoFocus={modal.type === 'repay_partial'} type="number" step="0.01" className="w-full bg-black/50 border border-white/10 rounded-2xl p-6 outline-none focus:border-indigo-500 text-5xl font-black text-white text-center" placeholder="0.00" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} />
                  {modal.type === 'repay_partial' && (
                    <button type="button" onClick={() => setForm({...form, amount: modal.data?.amount})} className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/10 px-3 py-1 rounded-full text-[10px] font-black uppercase hover:bg-white/20">Max</button>
                  )}
               </div>
               
               {/* BOUTONS D'ACTION UNIFIÉS */}
               <div className="flex flex-col gap-3">
                 <button type="submit" className={`w-full py-6 rounded-[2rem] font-black text-xl uppercase tracking-tighter shadow-xl transition-all ${modal.type === 'reimbursement' || modal.type === 'repay_partial' ? 'bg-emerald-600' : modal.type === 'exceptional' ? 'bg-red-600' : 'bg-indigo-600'}`}>
                    {modal.type === 'repay_partial' ? 'Remboursement (Recette)' : 'Confirmer'}
                 </button>
                 
                 {/* BOUTON ABSORBER (Uniquement pour les dettes) */}
                 {modal.type === 'repay_partial' && (
                    <button type="button" onClick={handleAbsorb} className="w-full py-4 rounded-[2rem] font-black text-sm uppercase tracking-widest text-amber-500 border border-amber-500/30 hover:bg-amber-500/10 flex items-center justify-center gap-2">
                       <Flame size={16} /> Absorber (Utiliser Trésorerie)
                    </button>
                 )}
               </div>
            </form>
          </div>
        </div>
      )}

      {/* NAV */}
      <nav className="fixed bottom-12 left-1/2 -translate-x-1/2 w-[90%] max-w-sm bg-zinc-900/60 backdrop-blur-3xl border border-white/10 px-10 py-7 rounded-[3rem] flex justify-between items-center z-50 shadow-2xl">
        <button onClick={() => setActiveTab('dashboard')} className={activeTab === 'dashboard' ? 'text-indigo-400 scale-150 transition-all' : 'text-zinc-700 transition-all'}><TrendingUp size={28} strokeWidth={3} /></button>
        <button onClick={() => setActiveTab('expenses')} className={activeTab === 'expenses' ? 'text-indigo-400 scale-150 transition-all' : 'text-zinc-700 transition-all'}><Users size={28} strokeWidth={3} /></button>
        <button onClick={() => setActiveTab('history')} className={activeTab === 'history' ? 'text-indigo-400 scale-150 transition-all' : 'text-zinc-700 transition-all'}><HistoryIcon size={28} strokeWidth={3} /></button>
      </nav>
    </div>
  );
}