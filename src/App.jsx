import React, { useState, useMemo, useEffect } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { 
  TrendingUp, Users, Plus, X, Trash2, ShieldCheck, History as HistoryIcon, 
  Zap, HeartPulse, Receipt, ArrowDownLeft, ArrowUpRight, Home, Calendar, 
  Coins, LogOut, Loader2
} from 'lucide-react';
import { supabase } from './supabase';

export default function NexusCloud() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login'); 
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState(null);

  // --- DONNÉES BUDGET ---
  const [fixedExpenses, setFixedExpenses] = useState([]);
  const [annualExpenses, setAnnualExpenses] = useState([]);
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [reimbursements, setReimbursements] = useState([]);
  const [exceptionalPaid, setExceptionalPaid] = useState([]);

  // UI
  const [activeTab, setActiveTab] = useState('dashboard');
  const [modal, setModal] = useState({ open: false, type: '', data: null });
  const [form, setForm] = useState({ label: '', amount: '', cat: 'fixed' });

  // --- AUTH & SYNC ---
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
    }
    setLoading(false);
  };

  const saveData = async () => {
    if (!session || loading) return;
    const updates = {
      user_id: session.user.id,
      fixed_expenses: fixedExpenses,
      annual_expenses: annualExpenses,
      pending: pending,
      history: history,
      reimbursements: reimbursements,
      exceptional_paid: exceptionalPaid
    };
    await supabase.from('nexus_data').upsert(updates);
  };

  useEffect(() => { saveData(); }, [fixedExpenses, annualExpenses, pending, history, reimbursements, exceptionalPaid]);

  // --- ACTIONS ---
  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setAuthError(null);
    const { error } = authMode === 'signup' 
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
    setLoading(false);
  };

  const handleForm = (e) => {
    e.preventDefault();
    const val = parseFloat(form.amount);
    if (isNaN(val) || val <= 0) return;

    if (modal.type === 'pending') setPending([{ id: Date.now(), label: form.label, amount: val }, ...pending]);
    else if (modal.type === 'exceptional') setExceptionalPaid([{ id: Date.now(), label: form.label, amount: val }, ...exceptionalPaid]);
    else if (modal.type === 'reimbursement') setReimbursements([{ id: Date.now(), label: form.label, amount: val }, ...reimbursements]);
    else if (modal.type === 'expense') {
      const item = { id: Date.now(), name: form.label, amount: val };
      form.cat === 'fixed' ? setFixedExpenses([...fixedExpenses, item]) : setAnnualExpenses([...annualExpenses, item]);
    }

    setModal({ open: false, type: '', data: null });
    setForm({ label: '', amount: '', cat: 'fixed' });
  };

  // --- CALCULS ---
  const totals = useMemo(() => {
    const totalFixed = fixedExpenses.reduce((acc, c) => acc + c.amount, 0);
    const totalAnnual = annualExpenses.reduce((acc, c) => acc + c.amount, 0);
    const provision = Math.round(totalAnnual / 12);
    const realCash = 1429 + reimbursements.reduce((acc, c) => acc + c.amount, 0) 
                          - exceptionalPaid.reduce((acc, c) => acc + c.amount, 0) 
                          - pending.reduce((acc, c) => acc + c.amount, 0);
    
    return { realCash, virement: Math.ceil((totalFixed + provision) / 2), totalFixed, totalAnnual };
  }, [fixedExpenses, annualExpenses, reimbursements, exceptionalPaid, pending]);

  const getIcon = (name) => {
    const n = name.toLowerCase();
    if (n.includes('crédit')) return <Home size={18}/>;
    if (n.includes('charges')) return <Zap size={18}/>;
    return <Receipt size={18}/>;
  };

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-indigo-500"><Loader2 className="animate-spin" size={48} /></div>;

  if (!session) return (
    <div className="min-h-screen bg-[#020202] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <h1 className="text-5xl font-black italic text-center uppercase">NEXUS<span className="text-indigo-500">.</span></h1>
        <div className="bg-zinc-900/50 border border-white/10 rounded-[2.5rem] p-8 space-y-6">
           <div className="flex gap-2 bg-black/50 p-1 rounded-2xl">
              <button onClick={() => setAuthMode('login')} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase ${authMode === 'login' ? 'bg-indigo-600' : 'text-zinc-600'}`}>Connexion</button>
              <button onClick={() => setAuthMode('signup')} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase ${authMode === 'signup' ? 'bg-indigo-600' : 'text-zinc-600'}`}>S'inscrire</button>
           </div>
           {authError && <p className="text-red-400 text-[10px] text-center font-bold uppercase">{authError}</p>}
           <form onSubmit={handleAuth} className="space-y-4">
              <input type="email" placeholder="Email" className="w-full bg-black/50 border border-white/10 rounded-2xl p-5 outline-none focus:border-indigo-500" value={email} onChange={e => setEmail(e.target.value)} />
              <input type="password" placeholder="Pass" className="w-full bg-black/50 border border-white/10 rounded-2xl p-5 outline-none focus:border-indigo-500" value={password} onChange={e => setPassword(e.target.value)} />
              <button type="submit" className="w-full bg-white text-black py-5 rounded-[2rem] font-black uppercase">Entrer</button>
           </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#020202] text-white pb-44 px-6 pt-14">
      <div className="max-w-md mx-auto space-y-10">
        <header className="flex justify-between items-center">
          <h1 className="text-4xl font-black italic uppercase">NEXUS<span className="text-indigo-500">.</span></h1>
          <button onClick={() => supabase.auth.signOut()} className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center text-zinc-500"><LogOut size={20} /></button>
        </header>

        {activeTab === 'dashboard' && (
          <div className="space-y-10">
            <div className="bg-zinc-900/40 border border-white/10 rounded-[3rem] p-9 backdrop-blur-xl">
              <p className="text-zinc-500 text-[10px] font-black uppercase italic mb-1">Cash Réel</p>
              <h2 className="text-6xl font-black tracking-tighter italic">{totals.realCash.toLocaleString()}€</h2>
            </div>

            <div className="grid grid-cols-3 gap-4">
               <button onClick={() => setModal({open:true, type:'exceptional'})} className="bg-zinc-900/50 p-5 rounded-[2rem] flex flex-col items-center"><ArrowUpRight size={22} className="text-red-500" /><span className="text-[8px] font-black uppercase mt-2">Payer</span></button>
               <button onClick={() => setModal({open:true, type:'reimbursement'})} className="bg-emerald-500/10 p-5 rounded-[2rem] flex flex-col items-center"><ArrowDownLeft size={22} className="text-emerald-500" /><span className="text-[8px] font-black uppercase mt-2">Recette</span></button>
               <button onClick={() => setModal({open:true, type:'pending'})} className="bg-white text-black p-5 rounded-[2rem] flex flex-col items-center"><Plus size={22}/><span className="text-[8px] font-black uppercase mt-2">Emprunt</span></button>
            </div>

            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest px-4">Dettes</h3>
              {pending.map(p => (
                <div key={p.id} className="bg-zinc-900/30 p-6 rounded-[2.5rem] flex justify-between items-center border border-white/5">
                  <span className="text-sm font-black uppercase italic">{p.label}</span>
                  <span className="text-amber-500 font-black text-xl">{p.amount}€</span>
                </div>
              ))}
            </section>
          </div>
        )}

        {activeTab === 'expenses' && (
          <div className="space-y-8">
            <div className="flex justify-between items-center">
              <h2 className="text-3xl font-black italic uppercase">Frais</h2>
              <button onClick={() => setModal({open:true, type:'expense'})} className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center"><Plus/></button>
            </div>
            <div className="space-y-2">
              {fixedExpenses.map(e => (
                <div key={e.id} className="bg-zinc-900/60 p-6 rounded-[2rem] flex justify-between items-center border border-white/5">
                  <div className="flex items-center gap-3 text-indigo-400">{getIcon(e.name)}<span className="text-zinc-200 font-bold">{e.name}</span></div>
                  <div className="flex items-center gap-4 font-black">{e.amount}€ <Trash2 size={16} className="text-zinc-700" onClick={() => setFixedExpenses(fixedExpenses.filter(x => x.id !== e.id))} /></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {modal.open && (
        <div className="fixed inset-0 bg-black/95 z-[200] flex items-end p-6 backdrop-blur-xl">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-md mx-auto rounded-[3rem] p-10">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-black uppercase italic">Ajouter</h2>
              <button onClick={() => setModal({open:false})}><X/></button>
            </div>
            <form onSubmit={handleForm} className="space-y-6">
              <input autoFocus placeholder="Nom" className="w-full bg-black/50 border border-white/10 rounded-2xl p-5 outline-none font-bold" value={form.label} onChange={e => setForm({...form, label: e.target.value})} />
              <input type="number" placeholder="0.00" className="w-full bg-black/50 border border-white/10 rounded-2xl p-5 outline-none text-4xl font-black text-center" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} />
              <button type="submit" className="w-full py-6 rounded-[2rem] bg-indigo-600 font-black uppercase">Confirmer</button>
            </form>
          </div>
        </div>
      )}

      <nav className="fixed bottom-10 left-1/2 -translate-x-1/2 w-[85%] bg-zinc-900/80 border border-white/10 p-6 rounded-[2.5rem] flex justify-around backdrop-blur-2xl">
        <button onClick={() => setActiveTab('dashboard')} className={activeTab === 'dashboard' ? 'text-indigo-400' : 'text-zinc-600'}><TrendingUp size={24}/></button>
        <button onClick={() => setActiveTab('expenses')} className={activeTab === 'expenses' ? 'text-indigo-400' : 'text-zinc-600'}><Users size={24}/></button>
        <button onClick={() => setActiveTab('history')} className={activeTab === 'history' ? 'text-indigo-400' : 'text-zinc-600'}><HistoryIcon size={24}/></button>
      </nav>
    </div>
  );
}