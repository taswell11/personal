import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Minus, 
  History, 
  TrendingUp, 
  Calendar,
  AlertCircle,
  ChevronLeft,
  Trash2,
  Edit2,
  Search,
  Filter,
  ArrowUpRight,
  RefreshCcw,
  X,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { Timestamp } from 'firebase/firestore';
import * as z from 'zod';
import { firebaseService, UserProfile, Ledger, Transaction } from '../services/firebaseService';

const transactionSchema = z.object({
  amount: z.number().min(0.01, 'Amount must be greater than zero'),
  description: z.string().optional(),
});
import { cn, formatCurrency, formatDate as localizedFormatDate } from '../lib/utils';
import { 
  AreaChart,
  Area,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';

interface LedgerViewProps {
  ledger: Ledger;
  onBack: () => void;
  profile: UserProfile;
}

export const LedgerView: React.FC<LedgerViewProps> = ({ ledger: initialLedger, onBack, profile }) => {
  const [ledger, setLedger] = useState<Ledger>(initialLedger);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showAdd, setShowAdd] = useState<'loan' | 'payment' | 'interest' | 'allocation' | null>(null);
  const [showDeleteNotice, setShowDeleteNotice] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'ledger' | 'transaction', id?: string } | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [transactionDate, setTransactionDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [allocation, setAllocation] = useState({ principal: 0, interest: 0 });
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [sortField, setSortField] = useState<'date' | 'amount'>('date');
  const [searchQuery, setSearchQuery] = useState('');
  const [showRatePrompt, setShowRatePrompt] = useState(false);
  const [tempRate, setTempRate] = useState('');

  const [allocatingTxId, setAllocatingTxId] = useState<string | null>(null);
  const [selectedCreditId, setSelectedCreditId] = useState<string>('');
  const [txInterestRate, setTxInterestRate] = useState('');

  useEffect(() => {
    if (showAdd === 'allocation') {
      setAllocation({ principal: Number(amount), interest: 0 });
    }
  }, [showAdd, amount]);

  useEffect(() => {
    const unsubLedger = firebaseService.subscribeToLedger(ledger.id, (l) => {
      setLedger(l);
      setTempRate((l.interestRate ?? 50).toString());
    });
    const unsubTxs = firebaseService.subscribeToTransactions(ledger.id, setTransactions);
    return () => {
      unsubLedger();
      unsubTxs();
    };
  }, [ledger.id]);

  useEffect(() => {
    if (transactions.length === 0) {
      const t = setTimeout(() => {
        if (
          Math.abs(ledger.currentBalance || 0) > 0.01 ||
          Math.abs(ledger.principalBalance || 0) > 0.01 ||
          Math.abs(ledger.interestBalance || 0) > 0.01 ||
          Math.abs(ledger.unallocatedBalance || 0) > 0.01
        ) {
          firebaseService.updateLedger(ledger.id, {
            currentBalance: 0,
            principalBalance: 0,
            interestBalance: 0,
            unallocatedBalance: 0
          });
        }
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [transactions.length, ledger.id, ledger.currentBalance, ledger.principalBalance, ledger.interestBalance, ledger.unallocatedBalance]);

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || submitting) return;
    
    setValidationError(null);
    try {
      transactionSchema.parse({
        amount: Number(amount),
        description: description
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        setValidationError(err.errors[0].message);
        return;
      }
    }

    setSubmitting(true);
    
    const form = e.currentTarget as HTMLFormElement;
    const paymentMethod = (form.elements.namedItem('paymentMethod') as HTMLSelectElement)?.value as 'cash' | 'transfer' | undefined;
    
    try {
      if (showAdd === 'allocation') {
        await firebaseService.allocatePayment(ledger.id, Number(amount), allocation, allocatingTxId || selectedCreditId || undefined);
        setAllocatingTxId(null);
        setSelectedCreditId('');
      } else if (editingTransaction) {
         await firebaseService.updateTransaction(ledger.id, editingTransaction.id, {
           amount: Number(amount),
           description: description || editingTransaction.description,
           type: showAdd as any,
           date: transactionDate,
           allocation: editingTransaction.type === 'loan' ? allocation : undefined
         });
      } else {
         if (showAdd === 'loan' && Number(txInterestRate) > 0) {
           // Interest now manually managed
         }
         
         const prVal = Number(amount);
         const rateVal = showAdd === 'loan' ? (Number(txInterestRate) || 0) : 0;
         const interestVal = prVal * (rateVal / 100);
         const txAmount = showAdd === 'loan' ? (prVal + interestVal) : prVal;
         const customAlloc = showAdd === 'loan' ? { principal: prVal, interest: interestVal } : undefined;
         const finalRate = showAdd === 'loan' ? rateVal : undefined;

         await firebaseService.addTransaction(
           ledger.id, 
           showAdd as any, 
           txAmount, 
           description || (showAdd === 'payment' ? 'Payment' : 'Additional funds'),
           transactionDate,
           paymentMethod,
           customAlloc,
           undefined,
           finalRate
         );
         
         const otherPartyId = profile.role === 'borrower' ? ledger.creditorId : ledger.borrowerId;
         if (otherPartyId) {
           await firebaseService.createNotification({
             userId: otherPartyId,
             title: showAdd === 'loan' ? 'New Loan Recorded' : 'Payment Received',
             message: `${profile.displayName} ${showAdd === 'loan' ? 'added a loan' : 'recorded a payment'} of R${amount}${paymentMethod ? ` via ${paymentMethod}` : ''}.`,
             type: showAdd === 'loan' ? 'info' : 'success'
           });
         }
      }

      setShowAdd(null);
      setEditingTransaction(null);
      setAmount('');
      setDescription('');
      setTxInterestRate('');
      setAllocation({ principal: 0, interest: 0 });
      setTransactionDate(format(new Date(), 'yyyy-MM-dd'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleInterest = async () => {
    if (submitting) return;
    const rate = ledger.interestRate ?? 50;
    const interestAmount = ledger.currentBalance * (rate / 100);
    if (interestAmount <= 0) return;
    
    setSubmitting(true);
    try {
      await firebaseService.addTransaction(
        ledger.id,
        'interest',
        interestAmount,
        `Monthly ${rate}% Interest`
      );
      
      if (ledger.borrowerId) {
        await firebaseService.createNotification({
          userId: ledger.borrowerId,
          title: 'Interest Applied',
          message: `Monthly ${rate}% interest of R${interestAmount.toLocaleString()} has been applied to your balance.`,
          type: 'warning'
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const exportToCSV = () => {
    const headers = ['Date', 'Type', 'Amount', 'Description', 'Balance'];
    
    let currentBalance = 0;
    const sortedTxs = [...transactions].sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
    const rows = sortedTxs.map(tx => {
      if (tx.type === 'loan' || tx.type === 'interest') currentBalance += tx.amount;
      else if (tx.type === 'allocation') currentBalance -= tx.amount;
      
      return [
        tx.createdAt ? formatDateTime(tx.createdAt) : '',
        tx.type.toUpperCase(),
        tx.amount.toString(),
        `"${tx.description.replace(/"/g, '""')}"`,
        currentBalance.toString()
      ].join(',');
    });
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `transaction_log_${ledger.borrowerName.replace(/ /g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  const executeDelete = async () => {
    if (!confirmDelete) return;
    if (confirmDelete.type === 'transaction' && confirmDelete.id) {
       await firebaseService.deleteTransaction(ledger.id, confirmDelete.id);
    } else if (confirmDelete.type === 'ledger') {
       await firebaseService.deleteLedger(ledger.id);
       onBack();
    }
    setConfirmDelete(null);
  };

  const handleUpdateRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempRate || isNaN(Number(tempRate))) return;
    await firebaseService.updateLedger(ledger.id, { interestRate: Number(tempRate) });
    setShowRatePrompt(false);
  };

  const searchedAndFilteredTransactions = transactions
    .filter(tx => {
      const matchSearch = tx.description.toLowerCase().includes(searchQuery.toLowerCase());
      if (filterType !== 'all' && tx.type !== filterType) return false;
      
      if (!tx.createdAt) return matchSearch;
      const txDate = tx.createdAt.toDate();
      
      let matchDate = true;
      if (filterStartDate) {
        const start = new Date(filterStartDate);
        if (txDate < start) matchDate = false;
      }
      if (filterEndDate) {
        const end = new Date(filterEndDate);
        end.setHours(23, 59, 59, 999);
        if (txDate > end) matchDate = false;
      }
      
      return matchDate && matchSearch;
    })
    .sort((a, b) => {
      if (sortField === 'amount') {
        return sortOrder === 'desc' ? b.amount - a.amount : a.amount - b.amount;
      }
      const dateA = a.createdAt?.toMillis() || 0;
      const dateB = b.createdAt?.toMillis() || 0;
      return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

  const chartData = transactions
    .slice()
    .sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0))
    .reduce((acc: any[], tx) => {
      const lastBalance = acc.length > 0 ? acc[acc.length - 1].balance : 0;
      const lastPrincipal = acc.length > 0 ? acc[acc.length - 1].principal : 0;
      const lastInterest = acc.length > 0 ? acc[acc.length - 1].interest : 0;
      
      let newBalance = lastBalance;
      let newPrincipal = lastPrincipal;
      let newInterest = lastInterest;

      if (tx.type === 'loan') {
        newBalance += tx.amount;
        if (tx.allocation) {
          newPrincipal += (tx.allocation.principal || 0);
          newInterest += (tx.allocation.interest || 0);
        } else {
          newPrincipal += tx.amount;
        }
      } else if (tx.type === 'interest') {
        newBalance += tx.amount;
        if (tx.allocation) {
          newPrincipal += (tx.allocation.principal || 0);
          newInterest += (tx.allocation.interest || 0);
        } else {
          newInterest += tx.amount;
        }
      } else if (tx.type === 'allocation') {
        newBalance -= tx.amount;
        const alloc = tx.allocation || { principal: 0, interest: 0 };
        newPrincipal -= (alloc.principal || 0);
        newInterest -= (alloc.interest || 0);
      }
      
      acc.push({
        date: format(tx.createdAt?.toDate() || new Date(), 'MMM dd'),
        balance: newBalance,
        principal: newPrincipal,
        interest: newInterest,
        amount: tx.amount,
        type: tx.type,
        description: tx.description
      });
      return acc;
    }, []);

  const interestRate = ledger.interestRate ?? 50;
  const projectedInterest = ledger.currentBalance * (interestRate / 100);
  const partnerName = profile.role === 'borrower' ? ledger.creditorName : ledger.borrowerName;
  const isAfter25th = new Date().getDate() >= 25;
  const paymentPot = transactions
    .filter(t => t.type === 'payment')
    .reduce((sum, t) => sum + (t.amount - (t.allocatedAmount || 0)), 0);

  return (
    <div className="min-h-screen bg-[#F1F5F9] pb-12 font-sans">
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-20 border-b border-slate-200 px-4 md:px-8 py-4 flex items-center justify-between text-slate-900">
        <div className="flex items-center gap-3 md:gap-4 overflow-hidden">
          <button onClick={onBack} className="p-2 md:p-2.5 text-slate-400 hover:text-slate-900 transition-colors bg-white border border-slate-200 rounded-xl shadow-sm shrink-0">
            <ChevronLeft size={20} />
          </button>
          <div className="truncate">
            <div className="text-[9px] md:text-[10px] text-slate-400 uppercase tracking-widest font-black truncate">Account Details</div>
            <h2 className="text-base md:text-lg font-black tracking-tight truncate">{partnerName}</h2>
          </div>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={exportToCSV}
            className="flex items-center gap-2 bg-slate-100 text-slate-700 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
          >
            <Download size={16} />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
          {profile.role === 'creditor' && (
            <button 
              onClick={() => transactions.length > 0 ? setShowDeleteNotice(true) : setConfirmDelete({ type: 'ledger' })}
              className="hidden sm:flex items-center gap-2 bg-red-50 text-red-600 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-red-100 transition-all"
            >
              <Trash2 size={16} />
              Delete Account
            </button>
          )}
          <button 
            disabled={profile.role === 'borrower'}
            onClick={() => setShowAdd('loan')}
            className="hidden sm:flex items-center gap-2 bg-[#0F172A] text-white px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-slate-900/10 hover:bg-slate-800 transition-all disabled:opacity-20"
          >
            <Plus size={16} />
            Issue Credit
          </button>
          <button 
            onClick={() => setShowAdd('payment')}
            className="hidden sm:flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-emerald-600/10 hover:bg-emerald-700 transition-all"
          >
            <Minus size={16} />
            Payment
          </button>
        </div>
      </header>

      <div className="p-4 md:p-8 max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-8">
        <div className="xl:col-span-5 space-y-8">
          <div className="bg-[#0F172A] p-6 md:p-8 rounded-[32px] md:rounded-[40px] shadow-2xl relative overflow-hidden text-white">
            <div className="relative z-10 space-y-6 md:space-y-8">
              <div className="space-y-1">
                <div className="text-[9px] md:text-[10px] uppercase tracking-[0.2em] font-black text-indigo-400">Total Owed</div>
                <div className="text-4xl md:text-5xl font-black tracking-tighter">{formatCurrency(ledger.currentBalance)}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 bg-white/5 rounded-2xl p-4 border border-white/5">
                  <div className="text-[8px] font-black text-indigo-300 uppercase mb-1">Total Repayment Value</div>
                  <div className="text-base md:text-lg font-black">{formatCurrency(transactions.filter(t => t.type === 'loan').reduce((s,t) => s + t.amount, 0) + ledger.interestBalance)}</div>
                </div>
                <div className={cn(
                  "rounded-2xl p-4 border transition-all",
                  (ledger.unallocatedBalance || 0) > 0 ? "bg-indigo-500/20 border-indigo-500/50" : "bg-white/5 border-white/5"
                )}>
                  <div className="text-[8px] font-black text-indigo-400 uppercase mb-1">Payment Pot</div>
                  <div className="text-base md:text-lg font-black">{formatCurrency(ledger.unallocatedBalance || 0)}</div>
                </div>
                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <div className="text-[8px] font-black text-emerald-400 uppercase mb-1">Payments allocated</div>
                  <div className="text-base md:text-lg font-black">{formatCurrency(transactions.filter(t => t.type === 'allocation').reduce((s,t) => s + t.amount, 0))}</div>
                </div>
              </div>

              {profile.role === 'creditor' && (ledger.unallocatedBalance || 0) > 0 && (
                <button 
                  onClick={() => {
                    setShowAdd('allocation');
                    setAmount(ledger.unallocatedBalance!.toString());
                  }}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-indigo-600/20 transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCcw size={14} />
                  Allocate Funds From Pot
                </button>
              )}

              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="principalGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#34D399" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#34D399" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="interestGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FBBF24" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#FBBF24" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-slate-900 text-white p-3 rounded-2xl shadow-xl border border-slate-800 space-y-2">
                               <div className="text-[10px] uppercase font-black text-slate-400">{data.date}</div>
                               <div className="font-black text-sm border-b border-white/10 pb-2">{data.description}</div>
                               <div className="flex justify-between items-center text-xs">
                                 <span className="text-emerald-400 font-bold">Principal</span>
                                 <span>{formatCurrency(data.principal)}</span>
                               </div>
                               <div className="flex justify-between items-center text-xs">
                                 <span className="text-amber-400 font-bold">Interest</span>
                                 <span>{formatCurrency(data.interest)}</span>
                               </div>
                               <div className="flex justify-between items-center text-sm pt-2 border-t border-white/10 font-black">
                                 <span className="text-indigo-300">Total</span>
                                 <span>{formatCurrency(data.balance)}</span>
                               </div>
                            </div>
                          )
                        }
                        return null;
                      }}
                    />
                    <Area type="monotone" dataKey="principal" stackId="1" stroke="#34D399" fill="url(#principalGrad)" strokeWidth={3} />
                    <Area type="monotone" dataKey="interest" stackId="1" stroke="#FBBF24" fill="url(#interestGrad)" strokeWidth={3} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-white/5">
                <div className="text-[12px] font-black bg-white/5 px-4 py-2 rounded-xl border border-white/5 flex items-center gap-2">
                  <Calendar size={14} className="text-indigo-400" />
                  Due: 25th {format(new Date(), 'MMM')}
                </div>
                {profile.role === 'creditor' && isAfter25th && (
                  <button onClick={handleInterest} className="text-[9px] font-black uppercase text-amber-400 bg-amber-400/10 px-4 py-2 rounded-xl border border-amber-400/20">
                    Apply Interest (R{projectedInterest.toLocaleString()})
                  </button>
                )}
                {profile.role === 'creditor' && (
                  <button 
                    onClick={async () => {
                      if (confirm(`Send payment reminder for R${ledger.currentBalance.toLocaleString()} to ${ledger.borrowerName}?`)) {
                        await emailService.sendPaymentReminder(ledger.borrowerEmail || '', ledger.borrowerName, ledger.currentBalance);
                        alert("Reminder sent!");
                      }
                    }}
                    className="text-[9px] font-black uppercase text-indigo-400 bg-indigo-400/10 px-4 py-2 rounded-xl border border-indigo-400/20"
                  >
                    Send Reminder
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="xl:col-span-7 space-y-8">
          
           {/* Issued Credits Section */}
           <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm overflow-hidden flex flex-col text-slate-900">
             <div className="p-4 sm:p-8 border-b border-slate-100 space-y-6">
               <div className="flex items-center justify-between">
                 <h3 className="text-xl font-black text-slate-900">Credits Issued</h3>
               </div>
             </div>
             <div className="p-4 flex-1 overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="text-[10px] uppercase font-black tracking-widest text-slate-400 border-b border-slate-100">
                    <tr>
                      <th className="py-4 px-4">Credit ID</th>
                      <th className="py-4 px-4">Date Issued</th>
                      <th className="py-4 px-4">Credit Value</th>
                      <th className="py-4 px-4">Interest</th>
                      <th className="py-4 px-4">Repayment Value</th>
                      <th className="py-4 px-4">Repaid</th>
                      <th className="py-4 px-4">Remaining</th>
                      <th className="py-4 px-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                     {(() => {
                        const loansSorted = [...transactions].filter(t => t.type === 'loan').sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
                        return loansSorted.map((tx, idx) => {
                          const creditId = `${ledger.borrowerName.split(' ')[0]}-cred-${(idx + 1).toString().padStart(3, '0')}`;
                          const interestRate = Number(tx.interestRate) || 0;
                          const hasValidAllocation = tx.allocation && (tx.allocation.interest > 0 || interestRate === 0);
                          const principal = hasValidAllocation ? tx.allocation.principal : (interestRate > 0 ? Math.round(tx.amount / (1 + interestRate / 100)) : tx.amount);
                          const interest = hasValidAllocation ? tx.allocation.interest : (tx.amount - principal);
                          const remaining = tx.amount - (tx.allocatedAmount || 0);
                          const isClosed = remaining <= 0;
                          return (
                            <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                              <td className="py-4 px-4 font-mono text-xs text-slate-500 font-bold">{creditId}</td>
                              <td className="py-4 px-4 text-slate-500 font-medium text-xs">
                                 {tx.createdAt ? format(tx.createdAt.toDate(), 'yyyy-MM-dd') : '...'}
                              </td>
                              <td className="py-4 px-4 font-black text-slate-900">R{principal.toLocaleString()}</td>
                              <td className="py-4 px-4 font-black text-amber-600">R{interest.toLocaleString()}</td>
                              <td className="py-4 px-4 font-black text-slate-900">R{tx.amount.toLocaleString()}</td>
                              <td className="py-4 px-4 font-black text-emerald-600">R{(tx.allocatedAmount || 0).toLocaleString()}</td>
                              <td className="py-4 px-4 font-black text-amber-600">R{Math.max(0, remaining).toLocaleString()}</td>
                              <td className="py-4 px-4 flex justify-center mt-1">
                                <span className={cn(
                                  "px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border",
                                  isClosed ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-amber-50 text-amber-600 border-amber-100"
                                )}>
                                  {isClosed ? 'Closed' : 'Active'}
                                </span>
                              </td>
                            </tr>
                          );
                        });
                     })()}
                   </tbody>
                </table>
             </div>
           </div>

           <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[600px] text-slate-900">
              <div className="p-4 sm:p-8 border-b border-slate-100 space-y-6">
                 <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black text-slate-900">Transaction Details</h3>
                    <button onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')} className="p-2 text-slate-400 bg-slate-50 rounded-xl">
                      <ArrowUpRight size={18} className={cn("transition-transform", sortOrder === 'desc' ? "rotate-90" : "-rotate-90")} />
                    </button>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl">
                       <Search size={16} className="text-slate-400" />
                       <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="bg-transparent border-none outline-none text-xs font-bold w-full" />
                    </div>
                    <div className="flex items-center gap-2">
                       <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="flex-1 bg-white border border-slate-200 rounded-2xl p-3 text-xs font-black">
                          <option value="all">All Types</option>
                          <option value="loan">Loans</option>
                          <option value="payment">Payments</option>
                          <option value="interest">Interest</option>
                       </select>
                       <button onClick={() => setShowRatePrompt(true)} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-indigo-600">
                          <TrendingUp size={16} />
                       </button>
                    </div>
                 </div>
              </div>

              <div className="p-4 flex-1 overflow-x-auto">
                 <table className="w-full text-left text-sm whitespace-nowrap">
                   <thead className="text-[10px] uppercase font-black tracking-widest text-slate-400 border-b border-slate-100">
                     <tr>
                       <th className="py-4 px-4">Transaction ID</th>
                       <th className="py-4 px-4">Transaction Type</th>
                       <th className="py-4 px-4">Date, Time</th>
                       <th className="py-4 px-4">Value</th>
                       <th className="py-4 px-4">Interest</th>
                       <th className="py-4 px-4">Reference</th>
                       <th className="py-4 px-4">Remaining Balance</th>
                       {profile.role === 'creditor' && <th className="py-4 px-4 text-right">Action</th>}
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100">
                     {(() => {
                       const txIDs = new Map<string, string>();
                       let credCount = 0;
                       let payCount = 0;
                       let allocCount = 0;

                       const sortedByTimeAsc = [...searchedAndFilteredTransactions].sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

                       sortedByTimeAsc.forEach(tx => {
                         if (tx.type === 'loan') {
                           credCount++;
                           txIDs.set(tx.id, `${ledger.borrowerName.split(' ')[0]}-cred-${credCount.toString().padStart(3, '0')}`);
                         } else if (tx.type === 'payment') {
                           payCount++;
                           txIDs.set(tx.id, `pay-${payCount.toString().padStart(3, '0')}`);
                         } else if (tx.type === 'allocation') {
                           allocCount++;
                           txIDs.set(tx.id, `alloc-${allocCount.toString().padStart(3, '0')}`);
                         } else {
                           txIDs.set(tx.id, `int-${credCount.toString().padStart(3, '0')}`);
                         }
                       });

                       const sortedByTimeDesc = [...sortedByTimeAsc].reverse();

                       return sortedByTimeDesc.map(tx => {
                         const txIdLabel = txIDs.get(tx.id) || tx.id.slice(0, 8);
                         const isCredit = tx.type === 'loan' || tx.type === 'interest';
                         const interestStr = tx.allocation?.interest ? `R${tx.allocation.interest}` : '-';
                         const valueStr = tx.allocation?.principal ? `R${tx.allocation.principal.toLocaleString()}` : (isCredit ? `R${tx.amount.toLocaleString()}` : `R${tx.amount.toLocaleString()}`);
                         const remainingBalance = isCredit ? (tx.amount - (tx.allocatedAmount || 0)) : null;

                         return (
                           <tr key={tx.id} className="hover:bg-slate-50 transition-colors group">
                             <td className="py-4 px-4 font-mono text-xs text-slate-500 font-bold">{txIdLabel}</td>
                             <td className="py-4 px-4">
                               <span className={cn("text-[10px] font-black uppercase px-2 py-1 rounded-full", isCredit ? "bg-indigo-50 text-indigo-600" : "bg-emerald-50 text-emerald-600")}>
                                 {isCredit ? 'Credit' : (tx.type === 'payment' ? 'Payment to Pot' : 'Allocation')}
                               </span>
                             </td>
                             <td className="py-4 px-4 text-slate-500 font-medium text-xs">
                               {tx.createdAt ? format(tx.createdAt.toDate(), 'yyyy-MM-dd HH:mm') : '...'}
                             </td>
                             <td className="py-4 px-4 font-black">
                               <div className={cn(isCredit ? "text-slate-900" : "text-emerald-600")}>
                                 {isCredit ? '+' : '-'}{valueStr}
                               </div>
                             </td>
                             <td className="py-4 px-4 font-black">
                               <div className="text-amber-600">
                                 {isCredit ? '+' : '-'}{interestStr}
                               </div>
                             </td>
                             <td className="py-4 px-4 text-slate-600 text-xs">
                               {tx.description}
                             </td>
                             <td className="py-4 px-4 font-black text-slate-600">
                               {remainingBalance !== null ? `R${remainingBalance.toLocaleString()}` : '-'} 
                             </td>
                             {profile.role === 'creditor' && (
                               <td className="py-4 px-4 text-right">
                                 <div className="flex justify-end gap-2">
                                   <button 
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        setEditingTransaction(tx); 
                                        setShowAdd(tx.type);
                                        setAmount(tx.amount.toString());
                                        setDescription(tx.description);
                                        setTransactionDate(tx.createdAt ? format(tx.createdAt.toDate(), 'yyyy-MM-dd') : '');
                                        if (tx.allocation) setAllocation(tx.allocation);
                                      }} 
                                      className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors"
                                    >
                                     <Edit2 size={16} />
                                   </button>
                                 </div>
                               </td>
                             )}
                           </tr>
                         );
                       });
                     })()}
                   </tbody>
                 </table>
              </div>
           </div>
        </div>
      </div>

      <AnimatePresence>
        {showAdd && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => { setShowAdd(null); setEditingTransaction(null); }}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" />
              <motion.div 
                initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} 
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-sm bg-white rounded-[32px] sm:rounded-[40px] p-6 sm:p-10 shadow-2xl space-y-6 sm:space-y-8 text-slate-900"
              >
                <h3 className="text-2xl font-black text-center">
                  {showAdd === 'loan' ? 'Issue Credit' : 
                   showAdd === 'payment' ? 'Record Payment' : 
                   showAdd === 'allocation' ? 'Allocate Funds' : 'Add Interest'}
                </h3>
              
              <form onSubmit={handleAddTransaction} className="space-y-6">
                {validationError && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-2xl text-xs font-bold text-center">
                    {validationError}
                  </div>
                )}
                <div className="space-y-2">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Amount</div>
                  <input 
                    required 
                    autoFocus 
                    disabled={showAdd === 'allocation'}
                    type="number" 
                    step="0.01" 
                    value={showAdd === 'allocation' ? paymentPot : amount} 
                    onChange={(e) => setAmount(e.target.value)} 
                    placeholder="0.00" 
                    className={cn("w-full text-center text-5xl font-black border-none focus:ring-0 outline-none", showAdd === 'allocation' ? "text-slate-400" : "text-slate-900")} 
                  />
                </div>

                {showAdd === 'allocation' ? (
                  <div className="space-y-4 bg-slate-50 p-6 rounded-[32px] border border-slate-100">
                    {!allocatingTxId && (
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Credit Transaction</label>
                        <select 
                          required
                          value={selectedCreditId}
                          onChange={(e) => {
                            const creditId = e.target.value;
                            setSelectedCreditId(creditId);
                            const selectedTx = transactions.find(t => t.id === creditId);
                            if (selectedTx) {
                              const outstanding = selectedTx.amount - (selectedTx.allocatedAmount || 0);
                              setAmount(Math.min(outstanding, paymentPot).toString());
                            }
                          }}
                          className="w-full bg-white border border-slate-200 rounded-2xl p-4 font-bold text-sm"
                        >
                          <option value="">-- Choose Credit --</option>
                          {transactions.filter(t => t.type === 'loan').map(tx => (
                            <option key={tx.id} value={tx.id}>{tx.description} ({formatCurrency(tx.amount)})</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Amount to Allocate</label>
                      <input 
                        required
                        type="number" 
                        step="0.01" 
                        max={paymentPot}
                        value={amount} 
                        onChange={(e) => setAmount(e.target.value)} 
                        placeholder="0.00" 
                        className="w-full bg-white border border-slate-200 rounded-2xl p-4 font-bold text-sm"
                      />
                    </div>

                    <div className="pt-4 border-t border-slate-200 flex justify-between items-center">
                      <span className="text-xs font-black uppercase text-indigo-600">Total</span>
                      <span className="font-black text-sm text-emerald-600">
                        {formatCurrency(Number(amount))}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {showAdd === 'loan' && (
                      <div className="space-y-2">
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Interest Rate (%)</label>
                         <select value={txInterestRate} onChange={(e) => setTxInterestRate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 font-bold text-sm">
                           <option value="0">0%</option>
                           <option value="10">10%</option>
                           <option value="20">20%</option>
                           <option value="30">30%</option>
                           <option value="40">40%</option>
                           <option value="50">50%</option>
                         </select>
                      </div>
                    )}
                    {showAdd !== 'payment' && (
                      <div className="space-y-2">
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Reference</label>
                         <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Note" className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 font-bold text-sm" />
                      </div>
                    )}
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Timestamp</label>
                       <input type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 font-bold text-sm" />
                    </div>
                    {showAdd === 'payment' && (
                      <select name="paymentMethod" className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 font-bold text-sm">
                        <option value="cash">Cash</option>
                        <option value="transfer">Bank Transfer</option>
                      </select>
                    )}
                  </div>
                )}

                <button 
                  disabled={!amount || submitting || (showAdd === 'allocation' && (allocation.principal + allocation.interest) !== Number(amount))} 
                  className="w-full bg-[#0F172A] text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs disabled:opacity-20 hover:bg-slate-800 transition-colors"
                >
                  {submitting ? 'Processing...' : (editingTransaction ? 'Save Changes' : 'Authorise Entry')}
                </button>
                {editingTransaction && (
                  <div className="flex gap-2 mt-4">
                    <button 
                      type="button" 
                      onClick={() => {
                        setConfirmDelete({ type: 'transaction', id: editingTransaction.id });
                        setShowAdd(null);
                        setEditingTransaction(null);
                      }}
                      className="flex-1 bg-red-50 text-red-600 border border-red-100 py-3 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-red-100 transition-colors"
                    >
                      Delete
                    </button>
                    {(editingTransaction.type === 'loan' || editingTransaction.type === 'interest') && (ledger.unallocatedBalance || 0) > 0 && (
                      <button 
                        type="button"
                        onClick={() => { 
                          setShowAdd('allocation'); 
                          setAllocatingTxId(editingTransaction.id);
                          setAmount(Math.min(ledger.unallocatedBalance || 0, editingTransaction.amount - (editingTransaction.allocatedAmount || 0)).toString()); 
                        }}
                        className="flex-1 bg-indigo-50 text-indigo-600 border border-indigo-100 py-3 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-indigo-100 transition-colors"
                      >
                        Allocate
                      </button>
                    )}
                  </div>
                )}
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showRatePrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowRatePrompt(false)}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} onClick={(e) => e.stopPropagation()} className="relative bg-white rounded-[32px] p-8 max-w-sm w-full shadow-2xl space-y-6 text-slate-900">
              <h3 className="text-xl font-black text-center">Interest Rate (%)</h3>
              <form onSubmit={handleUpdateRate} className="space-y-4">
                <select 
                  required 
                  value={tempRate} 
                  onChange={(e) => setTempRate(e.target.value)} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 font-black"
                >
                  <option value="0">0%</option>
                  <option value="10">10%</option>
                  <option value="20">20%</option>
                  <option value="30">30%</option>
                  <option value="40">40%</option>
                  <option value="50">50%</option>
                </select>
                <button className="w-full bg-[#0F172A] text-white py-4 rounded-2xl font-black uppercase text-xs">Update Rate</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmDelete && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-900/60" />
            <div onClick={(e) => e.stopPropagation()} className="relative bg-white rounded-[32px] p-8 max-w-sm w-full text-center space-y-6 text-slate-900">
              <Trash2 size={48} className="mx-auto text-red-500" />
              <p className="font-medium text-slate-500">Are you sure? This action cannot be undone.</p>
              <div className="flex gap-3">
                 <button onClick={() => setConfirmDelete(null)} className="flex-1 py-3 bg-slate-100 rounded-xl font-black uppercase text-[10px]">Cancel</button>
                 <button onClick={executeDelete} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-black uppercase text-[10px]">Delete</button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteNotice && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={() => setShowDeleteNotice(false)}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-900/60" />
            <div onClick={(e) => e.stopPropagation()} className="relative bg-white rounded-[32px] p-8 max-w-sm w-full text-center space-y-4 text-slate-900">
              <AlertCircle size={48} className="mx-auto text-amber-500" />
              <h3 className="text-xl font-black">Outstanding Transactions</h3>
              <p className="text-slate-500 text-sm">Please resolve or delete all transactions before deleting the account.</p>
              <button onClick={() => setShowDeleteNotice(false)} className="w-full bg-[#0F172A] text-white py-4 rounded-2xl font-black uppercase text-xs">Understood</button>
            </div>
          </div>
        )}
      </AnimatePresence>
      <div className="sm:hidden fixed bottom-6 left-6 right-6 z-[40]">
        <div className="bg-[#0F172A]/90 backdrop-blur-xl p-2 rounded-[32px] shadow-2xl border border-white/10 flex items-center justify-between">
          <button 
             disabled={profile.role === 'borrower'}
             onClick={() => setShowAdd('loan')}
             className="flex-1 flex items-center justify-center gap-2 py-4 text-white font-black text-[10px] uppercase tracking-widest disabled:opacity-20"
          >
            <Plus size={18} />
            Issue Credit
          </button>
          <div className="w-[1px] h-8 bg-white/10" />
          <button 
             onClick={() => setShowAdd('payment')}
             className="flex-1 flex items-center justify-center gap-2 py-4 text-emerald-400 font-black text-[10px] uppercase tracking-widest"
          >
            <Minus size={18} />
            Payment
          </button>
        </div>
      </div>
    </div>
  );
};
