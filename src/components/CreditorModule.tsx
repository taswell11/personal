import React, { useState, useEffect } from 'react';
import { loginWithGoogle, getAccessToken } from '../lib/firebase';
import { 
  Plus, 
  CheckCircle2, 
  XCircle, 
  TrendingUp, 
  User as UserIcon, 
  ArrowUpRight, 
  RefreshCcw,
  Clock,
  ChevronRight,
  AlertCircle,
  History,
  Lock,
  Mail
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { firebaseService, UserProfile, Ledger, LoanRequest, Transaction } from '../services/firebaseService';
import { emailService } from '../services/emailService';
import { cn, formatCurrency, formatDate as localizedFormatDate, formatDateTime } from '../lib/utils';
import { 
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';

interface CreditorModuleProps {
  profile: UserProfile;
  ledgers: Ledger[];
  requests: LoanRequest[];
  allTransactions: Transaction[];
  onSelectLedger: (ledger: Ledger) => void;
  onRecordPayment: () => void;
  onIssueLoan: () => void;
}

const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value, name, fill }: any) => {
  if (!value || value <= 0 || (name !== 'Owed' && name !== 'Payments')) return null;
  const RADIAN = Math.PI / 180;
  // Start right on the slice edge
  const sx = cx + outerRadius * Math.cos(-midAngle * RADIAN);
  const sy = cy + outerRadius * Math.sin(-midAngle * RADIAN);
  
  // Extend outward
  const mx = cx + (outerRadius + 15) * Math.cos(-midAngle * RADIAN);
  const my = cy + (outerRadius + 15) * Math.sin(-midAngle * RADIAN);
  
  // Horizontal line end
  const ex = mx + (mx > cx ? 12 : -12);
  const ey = my;
  
  const textAnchor = mx > cx ? 'start' : 'end';
  
  return (
    <g>
      {/* Visual connector line */}
      <path d={`M${sx},${sy}L${mx},${my}H${ex}`} stroke={fill} strokeWidth={1.5} fill="none" opacity={0.6} />
      {/* Label point circle */}
      <circle cx={ex} cy={ey} r={2} fill={fill} />
      {/* Floating text value */}
      <text 
        x={ex + (mx > cx ? 6 : -6)} 
        y={ey} 
        textAnchor={textAnchor} 
        dominantBaseline="central" 
        fill="#334155"
        className="text-[10px] font-extrabold tracking-tight"
      >
        {name} (R{value >= 1000 ? `${(value/1000).toFixed(1)}k` : value.toLocaleString()})
      </text>
    </g>
  );
};

export const CreditorModule: React.FC<CreditorModuleProps> = ({ 
  profile, 
  ledgers, 
  requests, 
  allTransactions,
  onSelectLedger,
  onRecordPayment,
  onIssueLoan
}) => {
  const [loading, setLoading] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentData, setPaymentData] = useState({ amount: '', ledgerId: '' });

  const [localRequests, setLocalRequests] = useState<LoanRequest[]>(requests);
  useEffect(() => {
    setLocalRequests(requests);
  }, [requests]);
  
  const [isLocked, setIsLocked] = useState(!!profile.dashboardPassword);
  const [unlockPin, setUnlockPin] = useState('');
  const [unlockError, setUnlockError] = useState(false);
  const [isGmailConnected, setIsGmailConnected] = useState(!!getAccessToken());
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);

  useEffect(() => {
    const handleStatusChange = () => {
      setIsGmailConnected(!!getAccessToken());
    };
    window.addEventListener('gmail-status-change', handleStatusChange);
    return () => {
      window.removeEventListener('gmail-status-change', handleStatusChange);
    };
  }, []);

  const handleConnectGmail = async () => {
    try {
      await loginWithGoogle();
      setIsGmailConnected(!!getAccessToken());
      alert("Gmail connected successfully!");
    } catch (e) {
      console.error(e);
      alert("Failed to connect Gmail. Please try again.");
    }
  };

  const handleUnlock = (e: React.FormEvent) => {
    if (unlockPin === profile.dashboardPassword) {
      setIsLocked(false);
    } else {
      setUnlockError(true);
      setTimeout(() => setUnlockError(false), 2000);
    }
  };

  const [issueData, setIssueData] = useState({
    email: '',
    name: '',
    phone: '',
    amount: '',
    interestRate: '10',
    description: '',
    dueDate: '',
    dateIssued: '',                
    isNewBorrower: true
  });
  const [activeLedger, setActiveLedger] = useState<Ledger | null>(null);
  const [showBorrowerProfile, setShowBorrowerProfile] = useState<string | null>(null);
  const [borrowers, setBorrowers] = useState<UserProfile[]>([]);
  
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentData.amount || !paymentData.ledgerId) return;
    setLoading(true);
    try {
      await firebaseService.addTransaction(
        paymentData.ledgerId,
        'payment',
        Number(paymentData.amount),
        'Payment received (to pot)'
      );
      alert("Payment recorded successfully to pot!");
      
      const ledger = ledgers.find(l => l.id === paymentData.ledgerId);
      if (ledger && ledger.borrowerEmail) {
        await emailService.sendPaymentRecorded(
          ledger.borrowerEmail,
          ledger.borrowerName || 'Borrower',
          Number(paymentData.amount),
          profile.displayName || 'Your Creditor'
        );
      }

      setShowPaymentModal(false);
      setPaymentData({ amount: '', ledgerId: '' });
    } finally {
      setLoading(false);
    }
  };

  const [activeChart, setActiveChart] = useState<'balance' | 'lent'>('balance');

  // Fetch borrower profiles
  React.useEffect(() => {
    firebaseService.getBorrowerProfiles(profile.uid).then(setBorrowers);
  }, [profile.uid]);

  const [selectedLedgerId, setSelectedLedgerId] = useState<string>('new');

  const handleIssueCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueData.amount || (selectedLedgerId === 'new' && !issueData.email)) return;
    setLoading(true);
    try {
      const amount = parseFloat(issueData.amount);
      const interestRate = parseFloat(issueData.interestRate);
      const interestAmount = amount * (interestRate / 100);
      const totalToRecord = amount + interestAmount;

      let ledgerId = selectedLedgerId;

      if (selectedLedgerId === 'new') {
        // Create new ledger for this email
        ledgerId = await firebaseService.createLedger({
          creditorId: profile.uid,
          creditorName: profile.displayName || 'Creditor',
          borrowerId: '', // Placeholder for auto-join
          borrowerName: issueData.name || issueData.email.split('@')[0],
          borrowerEmail: issueData.email.toLowerCase(),
          borrowerPhone: issueData.phone,
          principalBalance: amount,
          interestBalance: interestAmount,
          currentBalance: totalToRecord,
          unallocatedBalance: 0,
          interestRate: interestRate,
          dueDate: issueData.dueDate
        }, issueData.description || `Credit Issue: R${amount} + R${interestAmount} interest`) || '';
      } else {
        const ledger = ledgers.find(l => l.id === selectedLedgerId);
        if (ledger) {
          await firebaseService.addTransaction(
            ledger.id, 
            'loan', 
            totalToRecord, 
            issueData.description || `Credit Issue: R${amount} + R${interestAmount} interest`,
            undefined,
            undefined,
            { principal: amount, interest: interestAmount },
            issueData.dueDate,
            interestRate,
            issueData.retrospectiveDate
          );
        }
      }
      
      // Send real email notification
      await emailService.sendCreditIssued(
        issueData.email,
        profile.displayName || 'Your Creditor',
        amount,
        interestAmount
      );
      
      alert(`Successfully issued R${amount} credit (Total with interest: R${totalToRecord}). Email notification sent.`);
      setShowIssueModal(false);
      setIssueData({ email: '', name: '', phone: '', amount: '', interestRate: '10', description: '', dueDate: '', isNewBorrower: true });
      setSelectedLedgerId('new');
    } catch (err) {
      console.error(err);
      alert("Failed to issue credit. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const [approvalEdits, setApprovalEdits] = useState<Record<string, { interestRate: string, dueDate: string }>>({});

  const handleApproveRequest = async (requestId: string) => {
    // Optimistic UI status transition
    setLocalRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'approved' } : r));

    try {
      const request = requests.find(r => r.id === requestId);
      const edits = approvalEdits[requestId] || { 
        interestRate: request?.interestRate?.toString() || '10', 
        dueDate: request?.dateRequired || '' 
      };

      await firebaseService.approveLoanRequest(
        requestId, 
        profile.uid, 
        parseFloat(edits.interestRate),
        edits.dueDate
      );
      
      if (request) {
        const interestRate = parseFloat(edits.interestRate);
        const interestAmount = request.amount * (interestRate / 100);
        await emailService.sendCreditIssued(
          request.borrowerEmail,
          profile.displayName || 'Your Creditor',
          request.amount,
          interestAmount
        );
      }
    } catch (err) {
      console.error(err);
      // Revert optimistic state
      setLocalRequests(requests);
      alert("Failed to approve request.");
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    // Optimistic UI status transition
    setLocalRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'rejected' } : r));

    try {
      const request = requests.find(r => r.id === requestId);
      await firebaseService.updateRequestStatus(requestId, 'rejected');
      
      if (request) {
        await emailService.sendRequestRejected(
          request.borrowerEmail,
          profile.displayName || 'Your Creditor',
          request.amount
        );
      }
    } catch (err) {
      console.error(err);
      // Revert optimistic state
      setLocalRequests(requests);
      alert("Failed to reject request.");
    }
  };

  const totalBorrowers = ledgers.length;
  const totalOutstanding = ledgers.reduce((sum, l) => sum + l.currentBalance, 0);
  const totalPrincipal = ledgers.reduce((sum, l) => sum + (l.principalBalance || 0), 0);
  const totalInterest = ledgers.reduce((sum, l) => sum + (l.interestBalance || 0), 0);

  const pendingRequests = localRequests.filter(r => r.status === 'pending');

  // Calculate cumulative portfolio value over time for 4 metrics
  const allDailyStats = allTransactions
    .sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0))
    .reduce((acc: any[], tx) => {
      const date = tx.createdAt ? format(tx.createdAt.toDate(), 'MMM dd') : 'Pending';
      const last = acc.length > 0 ? acc[acc.length - 1] : { credits: 0, interest: 0, payments: 0, balance: 0 };
      
      const newStats = { ...last, date };
      
      if (tx.type === 'loan') newStats.credits += tx.amount;
      if (tx.type === 'interest') newStats.interest += tx.amount;
      if (tx.type === 'payment') newStats.payments += tx.amount;
      // Balance is a net calculation (Credits + Interest - Payments - Allocations/reductions)
      newStats.balance += (tx.type === 'loan' || tx.type === 'interest' ? tx.amount : -tx.amount);
      
      const existingIdx = acc.findIndex(a => a.date === date);
      if (existingIdx !== -1) {
        acc[existingIdx] = newStats;
      } else {
        acc.push(newStats);
      }
      return acc;
    }, []);

  // Calculate dynamic totals directly
  const totalPayments = allTransactions.filter(t => t.type === 'payment').reduce((acc, t) => acc + t.amount, 0);

  const innerChartData = [
    { name: 'Issued', value: totalPrincipal, fill: '#6366F1', description: 'Total value of core credit issued' },
    { name: 'Interest', value: totalInterest, fill: '#F59E0B', description: 'Accrued credit interest' },
  ];

  const outerChartData = [
    { name: 'Payments', value: totalPayments, fill: '#10B981', description: 'Repayment value received' },
    { name: 'Owed', value: totalOutstanding, fill: '#EF4444', description: 'Net outstanding balance' },
  ];

  const chartDataSummary = [
    ...innerChartData,
    ...outerChartData
  ];

  let interestChartData = allTransactions
    .filter(tx => tx.type === 'interest')
    .sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0))
    .reduce((acc: any[], tx) => {
      const date = tx.createdAt ? format(tx.createdAt.toDate(), 'MMM dd') : 'Pending';
      const lastTotal = acc.length > 0 ? acc[acc.length - 1].total : 0;
      const newTotal = lastTotal + tx.amount;
      
      const existing = acc.find(a => a.date === date);
      if (existing) {
        existing.total = newTotal;
      } else {
        acc.push({ date, total: newTotal });
      }
      return acc;
    }, []);

  // Ensure there's a baseline to draw a line
  if (interestChartData.length === 0) {
    interestChartData = [
      { date: 'Start', total: 0 },
      { date: 'End', total: 0 }
    ];
  } else if (interestChartData.length === 1) {
    interestChartData.unshift({ date: 'Start', total: 0 }); // Add a 0 point before the first to draw a line
  }

  const dailyStats = allDailyStats;

  if (isLocked) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="bg-white p-8 rounded-[40px] shadow-2xl w-full max-w-sm text-center border border-slate-100">
          <div className="w-16 h-16 bg-slate-50 text-slate-400 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Lock size={32} />
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-2">Dashboard Locked</h2>
          <p className="text-slate-500 text-sm mb-8">Enter your secure password to access your creditor dashboard.</p>
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
      {/* Welcome & Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Hello, {profile.displayName || 'Creditor'}!</h2>
          <p className="text-slate-500">View your credit portfolio as at {localizedFormatDate(new Date())}</p>
        </div>
        <div className="flex flex-wrap gap-3 ml-auto">
          <button 
            onClick={handleConnectGmail}
            className={cn(
              "px-6 py-4 rounded-2xl font-bold flex items-center gap-2 transition-all",
              isGmailConnected 
                ? "bg-emerald-50 text-emerald-700" 
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            <Mail size={20} />
            {isGmailConnected ? 'Gmail Connected' : 'Connect Gmail'}
          </button>
          <button 
            onClick={() => setShowIssueModal(true)}
            className="bg-[#0F172A] text-white px-6 py-4 rounded-2xl font-bold shadow-xl shadow-slate-900/10 hover:bg-slate-800 transition-all flex items-center gap-2 group"
          >
            <ArrowUpRight size={20} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
            Issue Credit
          </button>
          <button 
            onClick={() => setShowPaymentModal(true)}
            className="bg-emerald-500 text-white px-6 py-4 rounded-2xl font-bold shadow-xl shadow-emerald-500/20 hover:bg-emerald-600 transition-all flex items-center gap-2 group"
          >
            <Plus size={20} className="group-hover:rotate-90 transition-transform" />
            Record Payment
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Borrowers */}
        <div className="bg-[#0F172A]/80 backdrop-blur-md p-5 rounded-[32px] border border-slate-800/80 shadow-lg space-y-3 hover:scale-[1.02] hover:border-slate-700 transition-all duration-200 relative group">
          <div className="flex items-center justify-between">
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl">
              <UserIcon size={16} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black text-indigo-400 bg-indigo-500/20 px-2 py-0.5 rounded-full uppercase tracking-widest">Growth</span>
              <div className="relative group/tooltip inline-block">
                <AlertCircle size={12} className="text-slate-500 hover:text-indigo-400 cursor-help transition-colors" />
                <div className="absolute bottom-full right-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block bg-slate-900 text-white text-[11px] font-bold p-3 rounded-xl border border-slate-800 w-48 shadow-xl z-30 leading-relaxed text-center pointer-events-none">
                  The breakdown of primary registered borrowers and active loan contracts outstanding in your system.
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center">
            <div className="flex-1">
              <div className="text-[9px] text-slate-400 uppercase tracking-widest font-black mb-0.5">Borrowers</div>
              <div className="text-xl font-black text-white font-mono tracking-tight">{totalBorrowers}</div>
            </div>
            <div className="w-[1px] h-8 bg-slate-850/50 mx-3" />
            <div className="flex-1">
              <div className="text-[9px] text-slate-400 uppercase tracking-widest font-black mb-0.5">Loans Total</div>
              <div className="text-xl font-black text-white font-mono tracking-tight">
                {allTransactions.filter(t => t.type === 'loan' && (t.amount - (t.allocatedAmount || 0)) > 0).length}
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Lending */}
        <div className="bg-[#0F172A]/80 backdrop-blur-md p-5 rounded-[32px] border border-slate-800/80 shadow-lg space-y-3 hover:scale-[1.02] hover:border-slate-700 transition-all duration-200 relative group">
          <div className="flex items-center justify-between">
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl">
              <ArrowUpRight size={16} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full uppercase tracking-widest font-mono">Lending</span>
              <div className="relative group/tooltip inline-block">
                <AlertCircle size={12} className="text-slate-500 hover:text-indigo-400 cursor-help transition-colors" />
                <div className="absolute bottom-full right-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block bg-slate-900 text-white text-[11px] font-bold p-3 rounded-xl border border-slate-800 w-48 shadow-xl z-30 leading-relaxed text-center pointer-events-none">
                  The cumulative sum of principal credit issues generated across active ledgers.
                </div>
              </div>
            </div>
          </div>
          <div>
            <div className="text-[9px] text-slate-400 uppercase tracking-widest font-black mb-0.5">Total Lent</div>
            <div className="text-xl font-black text-white font-mono tracking-tight">{formatCurrency(totalPrincipal)}</div>
          </div>
        </div>

        {/* Card 3: Income */}
        <div className="bg-[#0F172A]/80 backdrop-blur-md p-5 rounded-[32px] border border-slate-800/80 shadow-lg space-y-3 hover:scale-[1.02] hover:border-slate-700 transition-all duration-200 relative group">
          <div className="flex items-center justify-between">
            <div className="p-2 bg-blue-500/10 text-blue-400 rounded-xl">
              <RefreshCcw size={16} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black text-blue-400 bg-blue-500/20 px-2 py-0.5 rounded-full uppercase tracking-widest">Income</span>
              <div className="relative group/tooltip inline-block">
                <AlertCircle size={12} className="text-slate-500 hover:text-indigo-400 cursor-help transition-colors" />
                <div className="absolute bottom-full right-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block bg-slate-900 text-white text-[11px] font-bold p-3 rounded-xl border border-slate-800 w-48 shadow-xl z-30 leading-relaxed text-center pointer-events-none">
                  The total accrued interest charged to borrowers based on approved ledger rates.
                </div>
              </div>
            </div>
          </div>
          <div>
            <div className="text-[9px] text-slate-400 uppercase tracking-widest font-black mb-0.5">Total Interest Value</div>
            <div className="text-xl font-black text-white font-mono tracking-tight">{formatCurrency(totalInterest)}</div>
            <div className="h-10 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={interestChartData}>
                  <Line type="monotone" dataKey="total" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Card 4: Payments */}
        <div className="bg-[#0F172A]/80 backdrop-blur-md p-5 rounded-[32px] border border-slate-800/80 shadow-lg hover:scale-[1.02] hover:border-slate-700 transition-all duration-200 flex flex-col overflow-hidden relative group">
          <div className="space-y-3 pb-3">
            <div className="flex items-center justify-between">
              <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl">
                <TrendingUp size={16} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black text-indigo-405 bg-indigo-550/25 text-indigo-400 bg-indigo-500/20 px-2 py-0.5 rounded-full uppercase tracking-widest">Payments</span>
                <div className="relative group/tooltip inline-block">
                  <AlertCircle size={12} className="text-slate-500 hover:text-indigo-400 cursor-help transition-colors" />
                  <div className="absolute bottom-full right-1/2 -translate-x-1/2 mb-2 hidden group-hover/tooltip:block bg-slate-900 text-white text-[11px] font-bold p-3 rounded-xl border border-slate-800 w-48 shadow-xl z-30 leading-relaxed text-center pointer-events-none font-sans font-medium">
                    Total amount of client capital received, allocated to principal/interest, or left unallocated in client pots.
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center">
              <div className="flex-1">
                <div className="text-[8px] text-white/50 uppercase tracking-widest font-black mb-0.5">Total Received</div>
                <div className="text-lg font-black text-white font-mono tracking-tight">{formatCurrency(allTransactions.filter(t => t.type === 'payment').reduce((acc, t) => acc + t.amount, 0))}</div>
              </div>
              <div className="w-[1px] h-8 bg-white/10 mx-3" />
              <div className="flex-1">
                <div className="text-[8px] text-white/50 uppercase tracking-widest font-black mb-0.5">Allocated</div>
                <div className="text-lg font-black text-white font-mono tracking-tight">{formatCurrency(allTransactions.filter(t => t.type === 'allocation').reduce((acc, t) => acc + t.amount, 0))}</div>
              </div>
            </div>
          </div>
          <div className="bg-white/5 p-4 border-t border-slate-800/50 mt-auto">
            <div className="text-[9px] text-white/50 uppercase tracking-widest font-black mb-0.5">Unallocated Payment Value</div>
            <div className="text-xl font-black text-emerald-400 font-mono tracking-tight">{formatCurrency(ledgers.reduce((acc, l) => acc + (l.unallocatedBalance || 0), 0))}</div>
          </div>
        </div>
      </div>

      {/* Portfolio Growth Chart */}
      <div className="bg-white p-6 md:p-8 rounded-[40px] border border-slate-200 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-black text-slate-900 tracking-tight">Portfolio Overview</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Aggregate view of credits, interest, payments, and balance owed.</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          {/* Left Column: Doughnut Chart with Center Text */}
          <div className="relative h-[384px] md:h-[420px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                {/* Inner Ring: Issued vs Interest */}
                <Pie
                  id="portfolio-inner-chart"
                  data={innerChartData}
                  innerRadius={70}
                  outerRadius={98}
                  paddingAngle={4}
                  dataKey="value"
                  onMouseEnter={(_, index) => {
                    if (innerChartData[index]) {
                      setHoveredSegment(innerChartData[index].name);
                    }
                  }}
                  onMouseLeave={() => setHoveredSegment(null)}
                >
                  {innerChartData.map((entry, index) => {
                    const isHovered = hoveredSegment === entry.name;
                    return (
                      <Cell 
                        key={`inner-cell-${index}`} 
                        fill={entry.fill}
                        style={{
                          filter: isHovered ? 'drop-shadow(0px 4px 12px rgba(0,0,0,0.15))' : 'none',
                          cursor: 'pointer',
                          transition: 'all 0.3s ease-in-out',
                          transform: isHovered ? 'scale(1.05)' : 'scale(1)',
                          transformOrigin: 'center'
                        }}
                      />
                    );
                  })}
                </Pie>

                {/* Outer Ring: Payments vs Owed */}
                <Pie
                  id="portfolio-outer-chart"
                  data={outerChartData}
                  innerRadius={113}
                  outerRadius={137}
                  paddingAngle={4}
                  dataKey="value"
                  onMouseEnter={(_, index) => {
                    if (outerChartData[index]) {
                      setHoveredSegment(outerChartData[index].name);
                    }
                  }}
                  onMouseLeave={() => setHoveredSegment(null)}
                  label={renderCustomizedLabel}
                >
                  {outerChartData.map((entry, index) => {
                    const isHovered = hoveredSegment === entry.name;
                    return (
                      <Cell 
                        key={`outer-cell-${index}`} 
                        fill={entry.fill}
                        style={{
                          filter: isHovered ? 'drop-shadow(0px 4px 12px rgba(0,0,0,0.15))' : 'none',
                          cursor: 'pointer',
                          transition: 'all 0.3s ease-in-out',
                          transform: isHovered ? 'scale(1.03)' : 'scale(1)',
                          transformOrigin: 'center'
                        }}
                      />
                    );
                  })}
                </Pie>

                <Tooltip 
                  cursor={{ fill: 'transparent' }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-slate-800 text-xs">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{payload[0].payload.name}</p>
                          <p className="text-lg font-black text-white">{formatCurrency(payload[0].value as number)}</p>
                          <p className="text-[9px] font-bold text-slate-400 mt-1 leading-relaxed">{payload[0].payload.description}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Absolute Center Circle Overlay */}
            <div className="absolute pointer-events-none flex flex-col items-center justify-center text-center">
              {hoveredSegment !== null ? (
                (() => {
                  const activeItem = chartDataSummary.find(item => item.name === hoveredSegment);
                  if (!activeItem) return null;
                  const totalPool = totalPrincipal + totalInterest;
                  return (
                    <div className="space-y-0.5 animate-fade-in">
                      <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                        {activeItem.name}
                      </div>
                      <div className="text-lg font-black text-slate-900">
                        {formatCurrency(activeItem.value)}
                      </div>
                      <div className="text-[8px] font-bold text-slate-400 uppercase tracking-wide">
                        {Math.round((activeItem.value / (totalPool || 1)) * 100)}% of Total
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="space-y-0.5">
                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                    Total Volume
                  </div>
                  <div className="text-xl font-black text-slate-900">
                    {formatCurrency(totalPrincipal + totalInterest)}
                  </div>
                  <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                    Concentric Pools
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Detailed breakdowns with custom interactive hover effects */}
          <div className="space-y-3">
            {chartDataSummary.map((entry) => {
              const isSelected = hoveredSegment === entry.name;
              const totalPool = totalPrincipal + totalInterest;
              return (
                <div 
                  key={entry.name}
                  onMouseEnter={() => setHoveredSegment(entry.name)}
                  onMouseLeave={() => setHoveredSegment(null)}
                  className={cn(
                    "p-4 rounded-3xl border transition-all cursor-pointer flex items-center justify-between gap-4",
                    isSelected 
                      ? "bg-slate-50 border-slate-200 shadow-sm scale-[1.02]" 
                      : "bg-white border-slate-100 hover:bg-slate-50/50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-3.5 h-3.5 rounded-full shadow-sm"
                      style={{ backgroundColor: entry.fill }}
                    />
                    <div>
                      <div className="text-xs font-black text-slate-900 tracking-tight">{entry.name}</div>
                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{entry.description}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-black text-slate-900">{formatCurrency(entry.value)}</div>
                    <div className="text-[9px] font-bold text-slate-400">
                      {Math.round((entry.value / (totalPool || 1)) * 100)}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-[#0F172A]/80 backdrop-blur-md p-6 md:p-8 rounded-[40px] border border-slate-800/80 shadow-xl space-y-6 text-white">
         <div className="flex items-center justify-between">
           <div>
             <h3 className="text-xl font-black text-white tracking-tight">Recent Transaction Activity</h3>
             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Global view of latest transactions across all ledgers</p>
           </div>
           <History size={20} className="text-slate-400" />
         </div>
         <div className="overflow-x-auto">
           <table className="w-full text-left text-sm whitespace-nowrap">
             <thead className="text-[10px] uppercase font-black tracking-widest text-slate-500 border-b border-slate-800/50">
               <tr>
                 <th className="py-4 px-6">Transaction Type</th>
                 <th className="py-4 px-6">Borrower</th>
                 <th className="py-4 px-6">Reference</th>
                 <th className="py-4 px-6">Transaction Date</th>
                 <th className="py-4 px-6">Timestamp</th>
                 <th className="py-4 px-6">Repayment Date</th>
                 <th className="py-4 px-6">Value</th>
               </tr>
             </thead>
             <tbody className="divide-y divide-slate-800/50 text-slate-300">
               {[...allTransactions]
                 .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0))
                 .slice(0, 5)
                 .map(tx => {
                   const isCredit = tx.type === 'loan' || tx.type === 'interest';
                   const isPaymentPot = tx.type === 'payment';
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
                       <td className="py-4 px-6 font-black text-white">{tx._ledgerName || 'Unknown'}</td>
                       <td className="py-4 px-6 text-slate-400 font-medium">{tx.description || '-'}</td>
                       <td className="py-4 px-6 text-slate-400 text-xs font-medium">
                         {tx.retrospectiveDate || '-'}
                       </td>
                       <td className="py-4 px-6 text-slate-400 text-xs font-medium">
                         {tx.createdAt ? formatDateTime(tx.createdAt) : 'Pending...'}
                       </td>
                       <td className="py-4 px-6 text-slate-400 text-xs font-medium">
                         {tx.dueDate || (tx.type === 'payment' ? (tx.retrospectiveDate || (tx.createdAt ? formatDateTime(tx.createdAt) : '-')) : '-')}
                       </td>
                       <td className="py-4 px-6 font-black">
                         <div className={cn(isCredit ? "text-slate-100 font-mono tracking-tight" : "text-emerald-400 font-mono tracking-tight")}>
                           {isCredit ? '+' : '-'}R{tx.amount.toLocaleString()}
                         </div>
                       </td>
                   </tr>
                 );
               })}
             </tbody>
           </table>
           {allTransactions.length === 0 && (
             <div className="text-center py-8 text-slate-400 text-xs font-bold uppercase tracking-widest">No recent transactions</div>
           )}
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Pending Approvals */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-[#0F172A]/80 backdrop-blur-md rounded-[32px] border border-slate-800/80 shadow-xl overflow-hidden text-white">
            <div className="p-4 sm:p-6 border-b border-slate-800/50 flex items-center justify-between">
              <h3 className="text-base font-black tracking-tight text-white">Approvals Pending</h3>
              <span className="px-2 py-1 rounded-lg bg-amber-50 text-amber-600 text-[10px] font-black uppercase tracking-widest">
                {pendingRequests.length} Pending
              </span>
            </div>
            <div className="p-4 space-y-3 max-h-[500px] overflow-y-auto">
              {pendingRequests.length === 0 ? (
                <div className="text-center py-12 space-y-2 opacity-30">
                  <CheckCircle2 size={48} className="mx-auto" />
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">All requests handled</p>
                </div>
              ) : (
                pendingRequests.map(req => (
                  <div key={req.id} className="p-5 rounded-[24px] bg-slate-900/40 border border-slate-800/60 flex flex-col gap-4 group transition-all hover:bg-slate-900/60 hover:border-slate-700 hover:scale-[1.01] duration-200">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="font-black text-white text-sm">{req.borrowerName}</div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">{req.borrowerEmail}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-black text-lg text-white font-mono tracking-tight">{formatCurrency(req.amount)}</div>
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                          {localizedFormatDate(req.createdAt)}
                        </div>
                      </div>
                    </div>
                    {req.description && (
                      <div className="bg-slate-950/45 p-3 rounded-xl border border-slate-800/60 text-[11px] text-slate-350 text-slate-300 font-medium">
                        "{req.description}"
                      </div>
                    )}
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Interest Rate (%)</label>
                        <select 
                          value={approvalEdits[req.id]?.interestRate ?? (req.interestRate?.toString() || '10')}
                          onChange={(e) => setApprovalEdits({
                            ...approvalEdits,
                            [req.id]: { 
                              ...(approvalEdits[req.id] || { interestRate: req.interestRate?.toString() || '10', dueDate: req.dateRequired }),
                              interestRate: e.target.value 
                            }
                          })}
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-100 outline-none focus:ring-2 focus:ring-indigo-600/30 transition-all font-mono"
                        >
                          <option value="0">0%</option>
                          <option value="10">10%</option>
                          <option value="20">20%</option>
                          <option value="30">30%</option>
                          <option value="40">40%</option>
                          <option value="50">50%</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Due Date</label>
                        <input 
                          type="date"
                          value={approvalEdits[req.id]?.dueDate ?? req.dateRequired}
                          onChange={(e) => setApprovalEdits({
                            ...approvalEdits,
                            [req.id]: { 
                              ...(approvalEdits[req.id] || { interestRate: req.interestRate?.toString() || '10', dueDate: req.dateRequired }),
                              dueDate: e.target.value 
                            }
                          })}
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-100 outline-none focus:ring-2 focus:ring-indigo-600/30 transition-all font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleRejectRequest(req.id)}
                        className="flex-1 py-2.5 rounded-xl border border-slate-800 text-slate-450 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400 hover:border-rose-500/25 transition-all flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest"
                      >
                        <XCircle size={14} />
                        Reject
                      </button>
                      <button 
                        onClick={() => handleApproveRequest(req.id)}
                        className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest"
                      >
                        <CheckCircle2 size={14} />
                        Approve
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Active Accounts List */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-[#0F172A]/80 backdrop-blur-md rounded-[32px] border border-slate-800/80 shadow-xl overflow-hidden text-white">
            <div className="p-4 sm:p-8 border-b border-slate-800/50 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black tracking-tight text-white">Active Accounts</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">Sorted by highest balance</p>
              </div>
              <button 
                className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline"
              >
                View All Accounts
              </button>
            </div>
            <div className="p-4 space-y-3">
              {ledgers.length === 0 ? (
                <div className="text-center py-12 space-y-2 opacity-30">
                  <AlertCircle size={48} className="mx-auto" />
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No active ledgers</p>
                </div>
              ) : (
                ledgers
                  .sort((a, b) => b.currentBalance - a.currentBalance)
                  .map(ledger => (
                    <div 
                      key={ledger.id} 
                      onClick={() => onSelectLedger(ledger)}
                      className="p-5 rounded-[24px] bg-slate-900/40 border border-slate-800/60 hover:bg-slate-900/60 hover:border-indigo-500/40 transition-all duration-200 flex items-center justify-between cursor-pointer group hover:scale-[1.01]"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-slate-950/45 text-slate-500 flex items-center justify-center border border-slate-800/80 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                          <UserIcon size={24} />
                        </div>
                        <div>
                          <div className="font-black text-white text-base">{ledger.borrowerName}</div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                            {ledger.borrowerEmail}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <div className="font-black text-xl tabular-nums tracking-tighter text-white font-mono">
                            {formatCurrency(ledger.currentBalance)}
                          </div>
                          <div className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Outstanding</div>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setShowBorrowerProfile(ledger.borrowerEmail || null); }}
                          className="p-2 bg-slate-900 rounded-xl text-slate-400 hover:bg-indigo-600 hover:text-white border border-slate-800 transition-all duration-200"
                        >
                          <UserIcon size={16} />
                        </button>
                        <ChevronRight size={20} className="text-slate-300 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Borrower Profile Modal */}
      <AnimatePresence>
        {showBorrowerProfile && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowBorrowerProfile(null)}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[60]" 
            />
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={() => setShowBorrowerProfile(null)}>
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }} 
                animate={{ scale: 1, opacity: 1, y: 0 }} 
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-sm bg-white rounded-[32px] p-8 shadow-2xl space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-black text-slate-900 tracking-tighter">Borrower Profile</h3>
                  <button onClick={() => setShowBorrowerProfile(null)} className="p-2 hover:bg-slate-100 rounded-2xl transition-colors">
                    <XCircle size={24} className="text-slate-400" />
                  </button>
                </div>
                {borrowers.find(b => b.email === showBorrowerProfile) ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Name</div>
                      <div className="font-bold text-slate-900">{borrowers.find(b => b.email === showBorrowerProfile)?.displayName || 'N/A'}</div>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Email</div>
                      <div className="font-bold text-slate-900">{showBorrowerProfile}</div>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Phone</div>
                      <div className="font-bold text-slate-900">{borrowers.find(b => b.email === showBorrowerProfile)?.phone || 'N/A'}</div>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500 font-medium">Profile details not available.</p>
                )}
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* Issue Credit Modal */}
      <AnimatePresence>
        {showIssueModal && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowIssueModal(false)}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[60]" 
            />
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={() => setShowIssueModal(false)}>
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }} 
                animate={{ scale: 1, opacity: 1, y: 0 }} 
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-lg bg-white rounded-[32px] sm:rounded-[48px] shadow-2xl p-6 sm:p-10 space-y-6 sm:space-y-8 max-h-[90vh] overflow-y-auto"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-3xl font-black text-slate-900 tracking-tighter">Issue Credit</h3>
                    <p className="text-slate-500 font-medium">Create a new loan or add to existing balance.</p>
                  </div>
                  <button onClick={() => setShowIssueModal(false)} className="p-3 hover:bg-slate-100 rounded-2xl transition-colors">
                    <XCircle size={28} className="text-slate-400" />
                  </button>
                </div>

                <form onSubmit={handleIssueCredit} className="space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Select Borrower</label>
                      <select 
                        value={selectedLedgerId}
                        onChange={(e) => {
                          setSelectedLedgerId(e.target.value);
                          if (e.target.value !== 'new') {
                            const l = ledgers.find(x => x.id === e.target.value);
                            if (l) setIssueData({ ...issueData, email: l.borrowerEmail || '', name: l.borrowerName, phone: l.borrowerPhone || '' });
                          } else {
                            setIssueData({ ...issueData, email: '', name: '', phone: '' });
                          }
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-[28px] px-8 py-5 focus:ring-4 focus:ring-indigo-600/5 focus:border-indigo-600 outline-none font-bold text-lg transition-all"
                      >
                        <option value="new">-- New Borrower --</option>
                        {ledgers.map(l => (
                          <option key={l.id} value={l.id}>{l.borrowerName} ({l.borrowerEmail})</option>
                        ))}
                      </select>
                    </div>

                    {selectedLedgerId === 'new' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Borrower's Name</label>
                          <input 
                            type="text" 
                            value={issueData.name}
                            onChange={(e) => setIssueData({ ...issueData, name: e.target.value })}
                            placeholder="John Doe"
                            className="w-full bg-slate-50 border border-slate-200 rounded-[28px] px-8 py-5 focus:ring-4 focus:ring-indigo-600/5 focus:border-indigo-600 outline-none font-bold transition-all"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Borrower's Email</label>
                          <input 
                            type="email" 
                            value={issueData.email}
                            onChange={(e) => setIssueData({ ...issueData, email: e.target.value })}
                            placeholder="borrower@example.com"
                            className="w-full bg-slate-50 border border-slate-200 rounded-[28px] px-8 py-5 focus:ring-4 focus:ring-indigo-600/5 focus:border-indigo-600 outline-none font-bold transition-all"
                            required
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Phone Number</label>
                          <input 
                            type="tel" 
                            value={issueData.phone}
                            onChange={(e) => setIssueData({ ...issueData, phone: e.target.value })}
                            placeholder="+27 12 345 6789"
                            className="w-full bg-slate-50 border border-slate-200 rounded-[28px] px-8 py-5 focus:ring-4 focus:ring-indigo-600/5 focus:border-indigo-600 outline-none font-bold transition-all"
                          />
                        </div>
                      </div>
                    )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Amount</label>
                          <div className="relative">
                            <span className="absolute left-8 top-1/2 -translate-y-1/2 font-black text-2xl text-slate-300">R</span>
                            <input 
                              type="number" 
                              value={issueData.amount}
                              onChange={(e) => setIssueData({ ...issueData, amount: e.target.value })}
                              placeholder="0.00"
                              className="w-full bg-slate-50 border border-slate-200 rounded-[28px] px-14 py-5 focus:ring-4 focus:ring-indigo-600/5 focus:border-indigo-600 outline-none font-black text-2xl tabular-nums transition-all"
                              required
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Interest Rate (%)</label>
                          <select 
                            value={issueData.interestRate}
                            onChange={(e) => setIssueData({ ...issueData, interestRate: e.target.value })}
                            className="w-full bg-slate-50 border border-slate-200 rounded-[28px] px-8 py-5 focus:ring-4 focus:ring-indigo-600/5 focus:border-indigo-600 outline-none font-black text-2xl transition-all"
                          >
                            <option value="0">0%</option>
                            <option value="10">10%</option>
                            <option value="20">20%</option>
                            <option value="30">30%</option>
                            <option value="40">40%</option>
                            <option value="50">50%</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Retrospective Credit Date</label>
                          <input 
                            type="date"
                            value={issueData.dateIssued}
                            onChange={(e) => setIssueData({ ...issueData, dateIssued: e.target.value })}
                            className="w-full bg-slate-50 border border-slate-200 rounded-[28px] px-8 py-5 focus:ring-4 focus:ring-indigo-600/5 focus:border-indigo-600 outline-none font-bold transition-all"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Expected Repayment Date</label>
                          <input 
                            type="date"
                            value={issueData.dueDate}
                            onChange={(e) => setIssueData({ ...issueData, dueDate: e.target.value })}
                            className="w-full bg-slate-50 border border-slate-200 rounded-[28px] px-8 py-5 focus:ring-4 focus:ring-indigo-600/5 focus:border-indigo-600 outline-none font-bold transition-all"
                          />
                        </div>
                      </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Reference</label>
                      <input 
                        type="text" 
                        value={issueData.description}
                        onChange={(e) => setIssueData({ ...issueData, description: e.target.value })}
                        placeholder="e.g. Monthly Advance"
                        className="w-full bg-slate-50 border border-slate-200 rounded-[28px] px-8 py-5 focus:ring-4 focus:ring-indigo-600/5 focus:border-indigo-600 outline-none font-bold transition-all"
                      />
                    </div>
                  </div>

                  <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-indigo-600 shadow-sm">
                      <AlertCircle size={24} />
                    </div>
                    <p className="text-base font-bold text-slate-500 leading-relaxed">
                      Total Repayable: <span className="text-indigo-600 font-black text-xl">{formatCurrency(parseFloat(issueData.amount || '0') * (1 + parseFloat(issueData.interestRate || '0') / 100))}</span>
                    </p>
                  </div>

                  <button 
                    type="submit"
                    disabled={loading}
                    className="w-full bg-indigo-600 text-white py-6 rounded-[28px] font-black text-xl shadow-2xl shadow-indigo-600/30 hover:bg-indigo-700 transition-all disabled:opacity-50 active:scale-[0.98]"
                  >
                    {loading ? 'Processing...' : 'Issue Credit'}
                  </button>
                </form>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
      
      {/* Payment Modal */}
      <AnimatePresence>
        {showPaymentModal && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowPaymentModal(false)}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[60]" 
            />
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={() => setShowPaymentModal(false)}>
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }} 
                animate={{ scale: 1, opacity: 1, y: 0 }} 
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-sm bg-white rounded-[32px] p-8 shadow-2xl space-y-6"
              >
                <h3 className="text-2xl font-black text-slate-900 text-center">Record Payment</h3>
                <form onSubmit={handleRecordPayment} className="space-y-6">
                    <select 
                      value={paymentData.ledgerId} 
                      onChange={(e) => setPaymentData({...paymentData, ledgerId: e.target.value})}
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 font-bold text-sm"
                      required
                    >
                        <option value="">-- Choose Account --</option>
                        {ledgers.map(l => <option key={l.id} value={l.id}>{l.borrowerName}</option>)}
                    </select>
                    <input 
                      type="number"
                      placeholder="Amount"
                      value={paymentData.amount}
                      onChange={(e) => setPaymentData({...paymentData, amount: e.target.value})}
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 font-bold text-sm"
                      required
                    />
                    <button type="submit" disabled={loading} className="w-full bg-emerald-600 text-white rounded-2xl p-4 font-black">{loading ? 'Processing...' : 'Record'}</button>
                </form>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
