import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  CreditCard, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  TrendingUp,
  History,
  ArrowRight,
  RefreshCcw,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import * as z from 'zod';
import { firebaseService, UserProfile, Ledger, LoanRequest, Transaction } from '../services/firebaseService';
import { emailService } from '../services/emailService';

const loanRequestSchema = z.object({
  amount: z.number().min(1, 'Amount must be greater than 0'),
  dateRequired: z.string().nonempty('Required date is needed'),
  description: z.string().min(3, 'Please provide a valid description')
});
import { cn, formatCurrency, formatDate as localizedFormatDate } from '../lib/utils';

interface BorrowerModuleProps {
  profile: UserProfile;
  ledgers: Ledger[];
  allTransactions: (Transaction & { _ledgerName: string, ledgerId: string })[];
  requests: LoanRequest[];
  onSelectLedger: (ledger: Ledger) => void;
}

export const BorrowerModule: React.FC<BorrowerModuleProps> = ({ 
  profile, 
  ledgers, 
  allTransactions,
  requests,
  onSelectLedger 
}) => {
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestAmount, setRequestAmount] = useState('');
  const [requestDateRequired, setRequestDateRequired] = useState('');
  const [requestDescription, setRequestDescription] = useState('');
  const [selectedCreditorId, setSelectedCreditorId] = useState(profile.linkedCreditorId || '');
  const [creditors, setCreditors] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [localRequests, setLocalRequests] = useState<LoanRequest[]>(requests);

  useEffect(() => {
    setLocalRequests(requests);
  }, [requests]);

  const [isLocked, setIsLocked] = useState(!!profile.dashboardPassword);
  const [unlockPin, setUnlockPin] = useState('');
  const [unlockError, setUnlockError] = useState(false);

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (unlockPin === profile.dashboardPassword) {
      setIsLocked(false);
    } else {
      setUnlockError(true);
      setTimeout(() => setUnlockError(false), 2000);
    }
  };

  useEffect(() => {
    const fetchCreditors = async () => {
      const list = await firebaseService.getAllCreditors();
      setCreditors(list);
    };
    fetchCreditors();
  }, []);

  const handleCancelRequest = async (requestId: string) => {
    // Instantaneous local UI state updates (optimistic feed-forward)
    setLocalRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'cancelled' } : r));

    try {
      const request = requests.find(r => r.id === requestId);
      await firebaseService.updateRequestStatus(requestId, 'cancelled');
      
      if (request) {
        await emailService.sendRequestCancelled(
          request.creditorEmail,
          profile.displayName || 'Borrower',
          request.amount
        );
      }
    } catch (err) {
      console.error(err);
      // Revert status on failure
      setLocalRequests(requests);
      alert("Failed to cancel request.");
    }
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCreditorId || loading) return;
    
    setValidationError(null);
    try {
      loanRequestSchema.parse({
        amount: Number(requestAmount),
        dateRequired: requestDateRequired,
        description: requestDescription
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        setValidationError(err.errors[0].message);
        return;
      }
    }

    setLoading(true);
    try {
      const creditor = creditors.find(c => c.uid === selectedCreditorId);
      if (!creditor) throw new Error("Creditor not found");

      await firebaseService.createLoanRequest({
        borrowerId: profile.uid,
        borrowerName: profile.displayName || 'Borrower',
        borrowerEmail: profile.email,
        creditorId: creditor.uid,
        creditorEmail: creditor.email,
        creditorName: creditor.displayName || 'Creditor',
        amount: Number(requestAmount),
        dateRequired: requestDateRequired,
        description: requestDescription,
        status: 'pending'
      });

      await firebaseService.createNotification({
        userId: creditor.uid,
        title: 'New Loan Request',
        message: `${profile.displayName} has requested a loan of R${requestAmount}.`,
        type: 'info'
      });

      await emailService.sendLoanRequest(
         creditor.email,
         profile.displayName || profile.email.split('@')[0],
         Number(requestAmount)
      );

      setShowRequestModal(false);
      setRequestAmount('');
      setRequestDescription('');
      setSelectedCreditorId('');
      alert("Loan request submitted successfully! Email sent to creditor.");
    } catch (err) {
      console.error(err);
      alert("Failed to send request.");
    } finally {
      setLoading(false);
    }
  };

    // Calculate dashboard stats
    const totalOutstanding = ledgers.reduce((sum, l) => sum + l.currentBalance, 0);
    const totalPrincipal = ledgers.reduce((sum, l) => sum + (l.principalBalance || 0), 0);
    const totalInterest = ledgers.reduce((sum, l) => sum + (l.interestBalance || 0), 0);
    const totalInPot = ledgers.reduce((sum, l) => sum + (l.unallocatedBalance || 0), 0);
    
    // Total payments allocated = sum of all transaction allocations? Actually, it's principal + interest - current balance for all ledgers? 
    // No, if they were allocated, then principalBalance implies remaining principal. 
    // So allocated = original principal borrowed? Wait, actually we can just look at `allTransactions` type === 'payment'.
    const totalPaymentsReceived = allTransactions.filter(tx => tx.type === 'payment').reduce((sum, tx) => sum + tx.amount, 0);
    const totalAllocated = totalPaymentsReceived - totalInPot;

  if (isLocked) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="bg-white p-8 rounded-[40px] shadow-2xl w-full max-w-sm text-center border border-slate-100">
          <div className="w-16 h-16 bg-slate-50 text-slate-400 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Lock size={32} />
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-2">Dashboard Locked</h2>
          <p className="text-slate-500 text-sm mb-8">Enter your secure password to access your borrower dashboard.</p>
          <form onSubmit={handleUnlock} className="space-y-4">
            <input 
              type="password"
              value={unlockPin}
              onChange={(e) => setUnlockPin(e.target.value)}
              placeholder="••••••••"
              className={cn(
                "w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center tracking-widest font-black text-lg outline-none focus:ring-2 focus:ring-indigo-600 transition-all",
                unlockError && "border-red-500 focus:ring-red-500"
              )}
              autoFocus
            />
            <button type="submit" disabled={!unlockPin} className="w-full bg-indigo-600 text-white rounded-2xl py-4 font-black mt-2 disabled:opacity-50 hover:bg-indigo-700 transition">
              Unlock Dashboard
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Welcome & Action Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-[#0F172A] tracking-tighter sm:text-5xl">
            Hello, {profile.displayName?.split(' ')[0] || 'Borrower'}
          </h2>
          <p className="text-slate-500 font-medium text-lg mt-2">
            View your credit portfolio as at {localizedFormatDate(new Date())}
          </p>
        </div>
        <button 
          onClick={() => setShowRequestModal(true)}
          className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold shadow-xl shadow-indigo-600/20 hover:bg-indigo-700 transition-all flex items-center gap-2 group w-full md:w-auto justify-center"
        >
          <Plus size={20} className="group-hover:rotate-90 transition-transform" />
          Request New Loan
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Paid in Pot */}
        <div className="bg-[#0F172A]/80 backdrop-blur-md p-6 rounded-[32px] border border-slate-800/80 shadow-lg space-y-2 relative group hover:scale-[1.02] hover:border-slate-700 transition-all duration-200">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-slate-400 uppercase tracking-widest font-black">Total Paid in Pot</div>
            <div className="relative group/tooltip inline-block">
              <AlertCircle size={14} className="text-slate-500 hover:text-indigo-400 cursor-help transition-colors" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block bg-slate-900 text-white text-[11px] font-bold p-3 rounded-xl border border-slate-800 w-48 shadow-xl z-30 leading-relaxed text-center pointer-events-none">
                Total payments sent to the creditor that haven't been allocated to a specific loan yet.
              </div>
            </div>
          </div>
          <div className="text-xl font-black text-emerald-400 tracking-tighter font-mono">R{totalInPot.toLocaleString()}</div>
        </div>

        {/* Payments Allocated */}
        <div className="bg-[#0F172A]/80 backdrop-blur-md p-6 rounded-[32px] border border-slate-800/80 shadow-lg space-y-2 relative group hover:scale-[1.02] hover:border-slate-700 transition-all duration-200">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-slate-400 uppercase tracking-widest font-black">Payments Allocated</div>
            <div className="relative group/tooltip inline-block">
              <AlertCircle size={14} className="text-slate-500 hover:text-indigo-400 cursor-help transition-colors" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block bg-slate-900 text-white text-[11px] font-bold p-3 rounded-xl border border-slate-800 w-48 shadow-xl z-30 leading-relaxed text-center pointer-events-none">
                Payments successfully assigned to reduce principal and interest of active loans.
              </div>
            </div>
          </div>
          <div className="text-xl font-black text-slate-200 tracking-tighter font-mono font-medium">R{totalAllocated.toLocaleString()}</div>
        </div>

        {/* Active Loans */}
        <div className="bg-[#0F172A]/80 backdrop-blur-md p-6 rounded-[32px] border border-slate-800/80 shadow-lg space-y-2 relative group hover:scale-[1.02] hover:border-slate-700 transition-all duration-200">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-slate-400 uppercase tracking-widest font-black">Active Loans</div>
            <div className="relative group/tooltip inline-block">
              <AlertCircle size={14} className="text-slate-500 hover:text-indigo-400 cursor-help transition-colors" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block bg-slate-900 text-white text-[11px] font-bold p-3 rounded-xl border border-slate-800 w-48 shadow-xl z-30 leading-relaxed text-center pointer-events-none">
                Number of currently unpaid open loan accounts.
              </div>
            </div>
          </div>
          <div className="text-xl font-black text-slate-200 tracking-tighter font-mono">
            {allTransactions.filter(t => t.type === 'loan' && (t.amount - (t.allocatedAmount || 0)) > 0).length}
          </div>
        </div>

        {/* Outstanding Balance */}
        <div className="bg-[#0F172A]/80 backdrop-blur-md p-6 rounded-[32px] border border-slate-800/80 shadow-lg space-y-2 relative group hover:scale-[1.02] hover:border-slate-700 transition-all duration-200">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-slate-400 uppercase tracking-widest font-black">Outstanding Balance</div>
            <div className="relative group/tooltip inline-block">
              <AlertCircle size={14} className="text-slate-500 hover:text-indigo-400 cursor-help transition-colors" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block bg-slate-900 text-white text-[11px] font-bold p-3 rounded-xl border border-slate-800 w-48 shadow-xl z-30 leading-relaxed text-center pointer-events-none">
                Remaining principal plus accrued interest currently owed to the creditor.
              </div>
            </div>
          </div>
          <div className="text-xl font-black text-rose-400 tracking-tighter font-mono">R{totalOutstanding.toLocaleString()}</div>
        </div>

        {/* Total Interest Output */}
        <div className="bg-[#0F172A]/80 backdrop-blur-md p-6 rounded-[32px] border border-slate-800/80 shadow-lg space-y-2 relative group hover:scale-[1.02] hover:border-slate-700 transition-all duration-200">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-slate-400 uppercase tracking-widest font-black">Total Interest Output</div>
            <div className="relative group/tooltip inline-block">
              <AlertCircle size={14} className="text-slate-500 hover:text-indigo-400 cursor-help transition-colors" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block bg-slate-900 text-white text-[11px] font-bold p-3 rounded-xl border border-slate-800 w-48 shadow-xl z-30 leading-relaxed text-center pointer-events-none">
                Total cumulative interest applied to your accounts based on standard credit terms.
              </div>
            </div>
          </div>
          <div className="text-xl font-black text-amber-450 tracking-tighter font-mono">R{totalInterest.toLocaleString()}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* Transaction History */}
        <div className="space-y-6">
          <div className="bg-[#0F172A]/80 backdrop-blur-md rounded-[32px] border border-slate-800/80 shadow-xl overflow-hidden h-fit">
            <div className="p-6 border-b border-slate-800/50 flex items-center justify-between">
              <h3 className="text-base font-black text-white tracking-tight">Transaction History</h3>
              <Clock size={18} className="text-slate-400" />
            </div>
            <div className="overflow-x-auto">
              {allTransactions.length === 0 ? (
                <div className="text-center py-12 space-y-2 opacity-30 cursor-default">
                  <History size={48} className="mx-auto text-slate-400" />
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No transaction history</p>
                </div>
              ) : (
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="text-[10px] uppercase font-black tracking-widest text-slate-500 border-b border-slate-800/50">
                    <tr>
                      <th className="py-4 px-6">Transaction Type</th>
                      <th className="py-4 px-6">Creditor</th>
                      <th className="py-4 px-6">Reference</th>
                      <th className="py-4 px-6">Timestamp</th>
                      <th className="py-4 px-6">Repayment Date</th>
                      <th className="py-4 px-6">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50 text-slate-300">
                    {[...allTransactions]
                      .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0))
                      .map(tx => {
                        const isCredit = tx.type === 'loan' || tx.type === 'interest';
                        return (
                          <tr key={tx.id} className="hover:bg-slate-800/40 transition-all duration-200">
                            <td className="py-4 px-6">
                              <span className={cn(
                                "text-[9px] font-black uppercase px-2.5 py-1 rounded-full",
                                isCredit ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" :
                                tx.type === 'payment' ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                              )}>
                                {tx.type === 'loan' ? 'LOAN' : tx.type === 'interest' ? 'INTEREST' : tx.type === 'payment' ? 'PAYMENT' : 'ALLOCATION'}
                              </span>
                            </td>
                            <td className="py-4 px-6 font-black text-white">{tx._ledgerName}</td>
                            <td className="py-4 px-6 text-slate-400 font-medium">{tx.description || '-'}</td>
                            <td className="py-4 px-6 text-slate-400 text-xs font-mono tracking-tight">{tx.createdAt ? localizedFormatDate(tx.createdAt) : 'Pending...'}</td>
                            <td className="py-4 px-6 text-slate-400 text-xs font-mono tracking-tight">{tx.dueDate || (tx.type === 'payment' ? (tx.retrospectiveDate || (tx.createdAt ? localizedFormatDate(tx.createdAt) : '-')) : '-')}</td>
                            <td className="py-4 px-6 font-black font-mono tracking-tight">
                              <div className={cn(isCredit ? "text-slate-100" : "text-emerald-400")}>
                                {isCredit ? '+' : '-'}R{tx.amount.toLocaleString()}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    }
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Pending Requests and All Requests */}
        <div className="space-y-6">
          <div className="bg-[#0F172A]/80 backdrop-blur-md rounded-[32px] border border-slate-800/80 shadow-xl overflow-hidden h-fit">
            <div className="p-6 border-b border-slate-800/50 flex items-center justify-between">
              <h3 className="text-base font-black text-white tracking-tight">Pending Requests</h3>
              <Clock size={18} className="text-slate-400" />
            </div>
            <div className="p-4 space-y-3 max-h-[300px] overflow-y-auto">
              {localRequests.filter(r => r.status === 'pending').length === 0 ? (
                <div className="text-center py-12 space-y-2 opacity-30">
                  <Clock size={48} className="mx-auto text-slate-400" />
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No pending requests</p>
                </div>
              ) : (
                [...localRequests].filter(r => r.status === 'pending').sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)).map(req => (
                  <div key={req.id} className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/60 flex items-center justify-between group transition-all hover:bg-slate-900/60 hover:border-slate-700 hover:scale-[1.01]">
                    <div className="space-y-1">
                      <div className="font-black text-white text-sm font-mono tracking-tight">{formatCurrency(req.amount)}</div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        To: {req.creditorName || 'Unknown Creditor'}
                      </div>
                      <div className="text-[9px] font-medium text-slate-500 font-mono tracking-tight">
                        {localizedFormatDate(req.createdAt)}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className={cn(
                        "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border text-center w-full min-w-[70px]",
                        "bg-amber-500/10 text-amber-400 border-amber-500/20"
                      )}>
                        {req.status}
                      </div>
                      <button
                        onClick={() => handleCancelRequest(req.id)}
                        className="text-[10px] font-bold text-slate-400 hover:text-rose-450 transition-colors uppercase tracking-widest flex items-center gap-1"
                      >
                        <XCircle size={12} />
                        Cancel
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-[#0F172A]/80 backdrop-blur-md rounded-[32px] border border-slate-800/80 shadow-xl overflow-hidden h-fit">
            <div className="p-6 border-b border-slate-800/50 flex items-center justify-between">
              <h3 className="text-base font-black text-white tracking-tight">All Requests</h3>
              <History size={18} className="text-slate-400" />
            </div>
            <div className="p-4 space-y-3 max-h-[500px] overflow-y-auto">
              {localRequests.length === 0 ? (
                <div className="text-center py-12 space-y-2 opacity-30">
                  <History size={48} className="mx-auto text-slate-400" />
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No request history</p>
                </div>
              ) : (
                [...localRequests].sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)).map(req => (
                  <div key={req.id} className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/60 flex items-center justify-between group transition-all hover:bg-slate-900/60 hover:border-slate-700 hover:scale-[1.01]">
                    <div className="space-y-1">
                      <div className="font-black text-white text-sm font-mono tracking-tight">{formatCurrency(req.amount)}</div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        To: {req.creditorName || 'Unknown Creditor'}
                      </div>
                      <div className="text-[9px] font-medium text-slate-500 font-mono tracking-tight">
                        {localizedFormatDate(req.createdAt)}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className={cn(
                        "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border text-center w-full min-w-[70px]",
                        req.status === 'pending' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                        req.status === 'approved' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                        req.status === 'cancelled' ? "bg-slate-800/50 text-slate-400 border-slate-800" :
                        "bg-rose-500/10 text-rose-400 border-rose-500/20"
                      )}>
                        {req.status}
                      </div>
                      {req.status === 'pending' && (
                        <button
                          onClick={() => handleCancelRequest(req.id)}
                          className="text-[10px] font-bold text-slate-400 hover:text-rose-500 transition-colors uppercase tracking-widest flex items-center gap-1"
                        >
                          <XCircle size={12} />
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        
      </div>

      {/* Loan Request Modal */}
      <AnimatePresence>
        {showRequestModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowRequestModal(false)}>
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" 
              />
              <motion.div 
                onClick={(e) => e.stopPropagation()}
                initial={{ y: 20, opacity: 0, scale: 0.95 }} 
                animate={{ y: 0, opacity: 1, scale: 1 }} 
                exit={{ y: 20, opacity: 0, scale: 0.95 }} 
                className="relative w-full max-w-md bg-white rounded-[32px] sm:rounded-[40px] p-6 sm:p-10 shadow-2xl space-y-6 sm:space-y-8"
              >
                <div className="space-y-1 text-center">
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">Request Loan</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Submit for creditor approval</p>
                </div>
                
                <form onSubmit={handleCreateRequest} className="space-y-8">
                  {validationError && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-2xl text-xs font-bold text-center">
                      {validationError}
                    </div>
                  )}
                  <div className="space-y-1 flex flex-col items-center">
                    <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Requested Amount</label>
                    <input 
                      required 
                      autoFocus 
                      type="number" 
                      value={requestAmount} 
                      onChange={(e) => setRequestAmount(e.target.value)} 
                      placeholder="0.00" 
                      className="w-full text-center text-6xl font-light border-none bg-transparent focus:ring-0 outline-none tabular-nums tracking-tighter text-slate-900" 
                    />
                    <div className="h-1 w-12 bg-indigo-600 rounded-full mt-4" />
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Date Required</label>
                            <input 
                                required
                                type="date"
                                value={requestDateRequired}
                                onChange={(e) => setRequestDateRequired(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-bold text-sm"
                            />
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Select Creditor</label>
                      <select 
                        required
                        value={selectedCreditorId}
                        onChange={(e) => setSelectedCreditorId(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-bold text-sm"
                      >
                        <option value="">-- Choose Creditor --</option>
                        {creditors.map(c => (
                          <option key={c.uid} value={c.uid}>{c.displayName} ({c.email})</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Description (Optional)</label>
                      <input 
                        type="text" 
                        value={requestDescription} 
                        onChange={(e) => setRequestDescription(e.target.value)} 
                        placeholder="e.g. For business expansion" 
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-bold text-sm" 
                      />
                    </div>
                  </div>

                  <button 
                    disabled={!requestAmount || !requestDateRequired || !selectedCreditorId || loading} 
                    className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black shadow-2xl shadow-indigo-600/20 hover:bg-indigo-700 transition-colors uppercase tracking-[0.2em] text-[10px] disabled:opacity-50"
                  >
                    {loading ? 'Processing...' : 'Submit Request'}
                  </button>
                </form>
              </motion.div>
            </div>

        )}
      </AnimatePresence>
    </div>
  );
};
