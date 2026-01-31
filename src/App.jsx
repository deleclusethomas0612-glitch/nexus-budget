import React, { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { 
  TrendingUp, Users, Wallet, AlertCircle, Plus, Check, X, Trash2, 
  Banknote, ShieldCheck, History as HistoryIcon, Zap, HeartPulse, 
  Receipt, ArrowDownLeft, ArrowUpRight, Home, Calendar, Coins
} from 'lucide-react';

export default function NexusEliteV9() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [modal, setModal] = useState({ open: false, type: '', data: null }); 
  
  const [fixedExpenses, setFixedExpenses] = useState([
    { id: 1, name: 'Crédit Immo', amount: 1250, icon: <Home size={18}/> },
    { id: 2, name: 'Charges Copro', amount: 260, icon: <Zap size={18}/> },
    { id: 4, name: 'Crèche', amount: 1281.83, icon: <HeartPulse size={18}/> },
  ]);

  const [annualExpenses, setAnnualExpenses] = useState([
    { id: 101, name: 'Taxe Foncière', amount: 2700 },
    { id: 102, name: 'Assurances/Divers', amount: 1848 },
  ]);

  const [pending, setPending] = useState([{ id: 1, label: 'Dépenses 2025', amount: 155 }]);
  const [history, setHistory] = useState([]);
  const [reimbursements, setReimbursements] = useState([]); 
  const [exceptionalPaid, setExceptionalPaid] = useState([]); 

  const [form, setForm] = useState({ label: '', amount: '', cat: 'fixed' });

  const totals = useMemo(() => {
    const totalFixed = fixedExpenses.reduce((acc, c) => acc + c.amount, 0);
    const totalAnnual = annualExpenses.reduce((acc, c) => acc + c.amount, 0);
    const creche = fixedExpenses.find(e => e.name.toLowerCase().includes('crèche'))?.amount || 0;
    const provision = Math.round(totalAnnual / 12);
    const virement = Math.ceil((totalFixed - creche + provision) / 2);
    const totalPending = pending.reduce((acc, c) => acc + c.amount, 0);
    const totalReimbursed = reimbursements.reduce((acc, c) => acc + c.amount, 0);
    const totalPaid = exceptionalPaid.reduce((acc, c) => acc + c.amount, 0);

    const realCash = 1429 + totalReimbursed - totalPaid - totalPending;
    const projection = Array.from({ length: 12 }, (_, i) => ({
      name: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'][i],
      solde: Math.round(realCash + (provision * i))
    }));

    return { virement, realCash, projection, provision, totalFixed, totalAnnual };
  }, [fixedExpenses, annualExpenses, reimbursements, exceptionalPaid, pending]);

  const addLog = (label, amount, type) => {
    setHistory([{ id: Date.now(), label, amount, type, date: new Date().toLocaleDateString('fr-FR', {day:'2-digit', month:'short'}) }, ...history]);
  };

  const handleForm = (e) => {
    e.preventDefault();
    const val = parseFloat(form.amount);
    if (isNaN(val) || val <= 0) return; // Sécurité montant

    // Correction de la validation : On ignore le libellé pour les remboursements partiels
    if (modal.type !== 'repay_partial' && !form.label) return;

    if (modal.type === 'pending') {
      setPending([{ id: Date.now(), label: form.label, amount: val }, ...pending]);
    } else if (modal.type === 'exceptional') {
      setExceptionalPaid([{ id: Date.now(), label: form.label, amount: val }, ...exceptionalPaid]);
      addLog(form.label, val, 'payment');
    } else if (modal.type === 'reimbursement') {
      setReimbursements([{ id: Date.now(), label: form.label, amount: val }, ...reimbursements]);
      addLog(form.label, val, 'reimb');
    } else if (modal.type === 'expense') {
      const item = { id: Date.now(), name: form.label, amount: val };
      if(form.cat === 'fixed') setFixedExpenses([...fixedExpenses, item]);
      else setAnnualExpenses([...annualExpenses, item]);
    } else if (modal.type === 'repay_partial') {
      const debt = modal.data;
      if (val >= debt.amount) {
        setPending(pending.filter(p => p.id !== debt.id));
        addLog(`Remboursé: ${debt.label}`, debt.amount, 'reimb');
      } else {
        setPending(pending.map(p => p.id === debt.id ? { ...p, amount: p.amount - val } : p));
        addLog(`Partiel: ${debt.label}`, val, 'reimb');
      }
    }
    setModal({ open: false, type: '', data: null });
    setForm({ label: '', amount: '', cat: 'fixed' });
  };

  return (
    <div className="min-h-screen bg-[#020202] text-white font-sans antialiased pb-44 px-6 pt-14 selection:bg-indigo-500/30">
      <div className="max-w-md mx-auto space-y-10">
        
        <header className="flex justify-between items-center px-2">
          <div className="relative">
            <h1 className="text-4xl font-black italic tracking-tighter uppercase leading-none">NEXUS<span className="text-indigo-500">.</span></h1>
            <div className="absolute -bottom-2 left-0 w-12 h-1 bg-indigo-500 rounded-full blur-[2px]" />
          </div>
          <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center text-indigo-500 shadow-2xl shadow-indigo-500/10"><ShieldCheck size={24} /></div>
        </header>

        {activeTab === 'dashboard' && (
          <div className="space-y-10 animate-in fade-in duration-700">
            <div className="bg-zinc-900/40 border border-white/10 rounded-[3rem] p-9 relative overflow-hidden backdrop-blur-xl shadow-2xl">
              <div className="absolute -top-24 -right-24 w-64 h-64 bg-indigo-600/10 blur-[100px]" />
              <div className="flex justify-between items-start mb-8 relative z-10">
                <div>
                  <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest italic mb-1">Cash Réel</p>
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
                    <XAxis dataKey="name" stroke="#3f3f46" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#09090b', border: 'none', borderRadius: '20px' }} itemStyle={{color:'#818cf8'}} />
                    <Area type="monotone" dataKey="solde" stroke="#6366f1" fill="url(#g)" strokeWidth={4} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
               <button onClick={() => setModal({open:true, type:'exceptional'})} className="bg-zinc-900/50 border border-white/5 p-5 rounded-[2rem] flex flex-col items-center active:scale-95 transition-all">
                  <ArrowUpRight size={22} className="mb-2 text-red-500" /><span className="text-[8px] font-black uppercase text-zinc-500 text-center tracking-tighter leading-tight">Payer</span>
               </button>
               <button onClick={() => setModal({open:true, type:'reimbursement'})} className="bg-emerald-500/10 border border-emerald-500/20 p-5 rounded-[2rem] flex flex-col items-center active:scale-95 transition-all">
                  <ArrowDownLeft size={22} className="mb-2 text-emerald-500" /><span className="text-[8px] font-black uppercase text-emerald-400 text-center tracking-tighter leading-tight text-emerald-400">Recette</span>
               </button>
               <button onClick={() => setModal({open:true, type:'pending'})} className="bg-white text-black p-5 rounded-[2rem] flex flex-col items-center active:scale-95 transition-all">
                  <Plus size={22} className="mb-2" /><span className="text-[8px] font-black uppercase text-center tracking-tighter leading-tight">Emprunt</span>
               </button>
            </div>

            <section className="space-y-5">
              <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.4em] px-4 italic">Dettes & Flux Actifs</h3>
              <div className="space-y-4 px-1">
                {pending.length === 0 ? <p className="text-center text-zinc-700 italic text-[10px] py-4">Toutes les dettes sont soldées.</p> : 
                pending.map(p => (
                  <button key={p.id} onClick={() => setModal({open:true, type:'repay_partial', data:p})} className="w-full text-left bg-zinc-900/30 border border-white/5 p-6 rounded-[2.8rem] flex justify-between items-center group relative overflow-hidden active:scale-[0.98] transition-all">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
                    <div className="flex items-center gap-5">
                       <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center text-amber-500"><Coins size={22} /></div>
                       <div><p className="text-sm font-black italic uppercase">{p.label}</p><p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest">Cliquer pour rembourser</p></div>
                    </div>
                    <span className="font-mono font-black text-amber-500 text-2xl">{p.amount}€</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'expenses' && (
          <div className="space-y-10 animate-in slide-in-from-right-10 duration-500 pb-20 text-white">
             <div className="flex justify-between items-center px-4">
                <h2 className="text-3xl font-black italic tracking-tighter uppercase leading-none">Architecture<br/><span className="text-indigo-500 text-sm tracking-widest uppercase not-italic font-bold">des charges</span></h2>
                <button onClick={() => setModal({open:true, type:'expense'})} className="w-14 h-14 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-2xl active:scale-90 transition-all"><Plus size={28}/></button>
             </div>

             <section className="space-y-8">
                <div className="space-y-4">
                  <div className="flex justify-between px-4 items-end">
                    <p className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.4em] italic leading-none">Mensuel Fixe</p>
                    <p className="text-xl font-black italic text-indigo-500 leading-none">{totals.totalFixed}€</p>
                  </div>
                  <div className="bg-zinc-900/20 border border-indigo-500/20 rounded-[3rem] p-2 space-y-2">
                    {fixedExpenses.map(e => (
                      <div key={e.id} className="bg-zinc-900/60 border border-white/5 p-6 rounded-[2.5rem] flex justify-between items-center">
                          <div className="flex items-center gap-4 text-indigo-400">
                            {e.icon || <Receipt size={18}/>}
                            <span className="text-sm font-bold text-zinc-200">{e.name}</span>
                          </div>
                          <div className="flex items-center gap-5 font-black text-indigo-400 text-lg italic">
                             {e.amount}€
                             <Trash2 size={18} className="text-zinc-800 hover:text-red-500 cursor-pointer transition-colors" onClick={() => setFixedExpenses(fixedExpenses.filter(x => x.id !== e.id))} />
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
                      <div key={e.id} className="bg-zinc-900/60 border border-white/5 p-6 rounded-[2.5rem] flex justify-between items-center">
                          <div className="flex items-center gap-4 text-emerald-500">
                            <Calendar size={18}/>
                            <span className="text-sm font-bold text-zinc-200">{e.name}</span>
                          </div>
                          <div className="flex items-center gap-5 font-black text-emerald-500 text-lg italic">
                             {e.amount}€
                             <Trash2 size={18} className="text-zinc-800 hover:text-red-500 cursor-pointer transition-colors" onClick={() => setAnnualExpenses(annualExpenses.filter(x => x.id !== e.id))} />
                          </div>
                      </div>
                    ))}
                  </div>
                </div>
             </section>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-8 animate-in slide-in-from-left-10 duration-500 pb-20">
             <div className="bg-gradient-to-br from-zinc-900 to-indigo-900 rounded-[3.5rem] p-10 shadow-2xl relative overflow-hidden border border-white/5">
                <p className="text-indigo-200 text-[10px] font-black uppercase tracking-widest mb-1 italic">Journal des Flux</p>
                <h2 className="text-7xl font-black italic tracking-tighter leading-none">{history.length}</h2>
             </div>
             <div className="space-y-4">
                {history.map(h => (
                  <div key={h.id} className="bg-zinc-900/30 border border-white/5 p-6 rounded-[2.5rem] flex justify-between items-center">
                     <div className="flex items-center gap-5">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${h.type === 'payment' ? 'bg-red-500/10 text-red-500' : h.type === 'reimb' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-indigo-500/10 text-indigo-500'}`}>
                           {h.type === 'payment' ? <ArrowUpRight size={20}/> : <ArrowDownLeft size={20}/>}
                        </div>
                        <div><p className="text-sm font-black italic uppercase tracking-tighter">{h.label}</p><p className="text-[8px] text-zinc-600 font-bold uppercase">{h.date}</p></div>
                     </div>
                     <span className={`font-black italic text-xl ${h.type === 'payment' ? 'text-red-500' : h.type === 'reimb' ? 'text-emerald-500' : 'text-indigo-400'}`}>
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
              <h2 className={`text-2xl font-black italic uppercase tracking-tighter ${modal.type === 'reimbursement' ? 'text-emerald-400' : modal.type === 'exceptional' ? 'text-red-400' : 'text-white'}`}>
                {modal.type === 'repay_partial' ? 'Remboursement' : modal.type === 'pending' ? 'Nouvel Emprunt' : modal.type === 'exceptional' ? 'Paiement Réel' : modal.type === 'reimbursement' ? 'Recette' : 'Nouvelle Charge'}
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
               {modal.type !== 'repay_partial' && (
                 <input autoFocus className="w-full bg-black/50 border border-white/10 rounded-2xl p-6 outline-none focus:border-indigo-500 font-bold text-lg text-white" placeholder="Libellé" value={form.label} onChange={e => setForm({...form, label: e.target.value})} />
               )}
               {modal.type === 'repay_partial' && (
                 <div className="text-center p-6 bg-amber-500/10 rounded-3xl mb-4 border border-amber-500/20">
                    <p className="text-[10px] font-black uppercase text-amber-500 mb-1 tracking-widest italic">Dette: {modal.data?.label}</p>
                    <p className="text-4xl font-black text-amber-500 italic">{modal.data?.amount}€</p>
                 </div>
               )}
               <div className="relative">
                  <input autoFocus={modal.type === 'repay_partial'} type="number" step="0.01" className="w-full bg-black/50 border border-white/10 rounded-2xl p-6 outline-none focus:border-indigo-500 text-5xl font-black text-white text-center" placeholder="0.00" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} />
                  {modal.type === 'repay_partial' && (
                    <button type="button" onClick={() => setForm({...form, amount: modal.data?.amount})} className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/10 px-3 py-1 rounded-full text-[10px] font-black uppercase">Max</button>
                  )}
               </div>
               <button type="submit" className={`w-full py-8 rounded-[2.5rem] font-black text-xl uppercase tracking-tighter shadow-xl transition-all ${modal.type === 'reimbursement' || modal.type === 'repay_partial' ? 'bg-emerald-600 shadow-emerald-600/20' : modal.type === 'exceptional' ? 'bg-red-600 shadow-red-600/20' : 'bg-indigo-600 shadow-indigo-600/20'}`}>Confirmer</button>
            </form>
          </div>
        </div>
      )}

      <nav className="fixed bottom-12 left-1/2 -translate-x-1/2 w-[90%] max-w-sm bg-zinc-900/60 backdrop-blur-3xl border border-white/10 px-10 py-7 rounded-[3rem] flex justify-between items-center z-50 shadow-2xl">
        <button onClick={() => setActiveTab('dashboard')} className={`transition-all ${activeTab === 'dashboard' ? 'text-indigo-400 scale-150' : 'text-zinc-700'}`}><TrendingUp size={28} strokeWidth={3} /></button>
        <button onClick={() => setActiveTab('expenses')} className={`transition-all ${activeTab === 'expenses' ? 'text-indigo-400 scale-150' : 'text-zinc-700'}`}><Users size={28} strokeWidth={3} /></button>
        <button onClick={() => setActiveTab('history')} className={`transition-all ${activeTab === 'history' ? 'text-indigo-400 scale-150' : 'text-zinc-700'}`}><HistoryIcon size={28} strokeWidth={3} /></button>
      </nav>
    </div>
  );
}