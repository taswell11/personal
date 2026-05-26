import React, { useState, useEffect } from 'react';
import { auth, logout as firebaseLogout, getAccessToken, loginWithGoogle } from './lib/firebase';
import { firebaseService, UserProfile, Ledger, Transaction, LoanRequest } from './services/firebaseService';
import { emailService } from './services/emailService';
import { onAuthStateChanged, User } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LogOut, 
  CreditCard,
  Bell,
  Menu,
  X,
  History as HistoryIcon,
  LayoutDashboard,
  Users as UsersIcon,
  RefreshCcw,
  Plus,
  CreditCard as CreditCardIcon,
  ShieldCheck,
  Mail
} from 'lucide-react';
import { cn, formatCurrency, formatDate as localizedFormatDate, formatDateTime } from './lib/utils';
import { format } from 'date-fns';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from './lib/firebase';

// Import Modular Components
import { LoginView } from './components/LoginView';
import { BorrowerModule } from './components/BorrowerModule';
import { CreditorModule } from './components/CreditorModule';
import { LedgerView } from './components/LedgerView';

// Triggering a rebuild after recent edits
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [requests, setRequests] = useState<LoanRequest[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [allTransactions, setAllTransactions] = useState<(Transaction & { _ledgerName: string, ledgerId: string })[]>([]);
  const [activeLedger, setActiveLedger] = useState<Ledger | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'accounts' | 'history'>('dashboard');
  const [txTypeFilter, setTxTypeFilter] = useState<string>('all');
  const [txAccountFilter, setTxAccountFilter] = useState<string>('all');
  const [showNotifications, setShowNotifications] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [invitation, setInvitation] = useState<any>(null);
  const [gmailActive, setGmailActive] = useState(!!getAccessToken());
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editProfileName, setEditProfileName] = useState('');
  const [editDashboardPassword, setEditDashboardPassword] = useState('');
  const [emailLogs, setEmailLogs] = useState<any[]>([]);

  // Invitation Handling
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteId = params.get('invite');
    if (inviteId) {
      firebaseService.getInvitation(inviteId).then(setInvitation);
    }
  }, []);

  // Sync Gmail Active State with Event Listener
  useEffect(() => {
    const handleStatusChange = () => {
      setGmailActive(!!getAccessToken());
    };
    window.addEventListener('gmail-status-change', handleStatusChange);
    return () => {
      window.removeEventListener('gmail-status-change', handleStatusChange);
    };
  }, []);

  // Authentication & Profile Setup
  useEffect(() => {
    return onAuthStateChanged(auth, async (u: User | null) => {
      try {
        if (u) {
          const email = u.email?.toLowerCase();
          if (email && (email === 'taswell@ecomplete.co.za' || email === 'tazzytest1@gmail.com')) {
            await firebaseLogout();
            setUser(null);
            setProfile(null);
            setLoading(false);
            return;
          }
          setUser(u);
          let p = await firebaseService.getUserProfile(u.uid);
          
          // Create profile if it does not exist, using the selected role
          if (!p) {
            const preferredRole = (localStorage.getItem('preferredRole') as 'borrower' | 'creditor') || 'borrower';
            await firebaseService.ensureUserProfile(u.uid, { 
              role: preferredRole,
              email: u.email || '',
              displayName: u.displayName || 'User'
            });
            p = await firebaseService.getUserProfile(u.uid);
            localStorage.removeItem('preferredRole');
          }
          if (u.email) {
            await firebaseService.linkBorrowerLedgers(u.uid, u.email);
          }
          
          setProfile(p);
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (err) {
        console.error("Auth initialisation error:", err);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  // Data Subscriptions
  useEffect(() => {
    if (!profile) return;

    const unsubLedgers = firebaseService.subscribeToLedgers(profile.uid, profile.role, setLedgers);

    const unsubRequests = firebaseService.subscribeToRequests(profile.uid, profile.role, setRequests);
    const unsubNotes = firebaseService.subscribeToNotifications(profile.uid, setNotifications);
    const unsubEmailLogs = firebaseService.subscribeToEmailLogs(profile.uid, setEmailLogs);

    return () => {
      unsubLedgers();
      unsubRequests();
      unsubNotes();
      unsubEmailLogs();
    };
  }, [profile]);

  // Aggregate Transactions for Global History
  useEffect(() => {
    if (!profile || ledgers.length === 0) {
      setAllTransactions([]);
      return;
    }
    const unsubs = ledgers.map(l => 
      firebaseService.subscribeToTransactions(l.id, (txs: Transaction[]) => {
        setAllTransactions(prev => {
          const others = prev.filter(p => p.ledgerId !== l.id);
          const ledgerName = profile.role === 'creditor' ? l.borrowerName : l.creditorName;
          return [...others, ...txs.map(t => ({ ...t, _ledgerName: ledgerName, ledgerId: l.id }))];
        });
      })
    );
    return () => unsubs.forEach(u => u());
  }, [ledgers, profile]);

  const handleLogout = async () => {
    await firebaseLogout();
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;
    try {
      setLoading(true);
      await firebaseService.ensureUserProfile(user.uid, {
        displayName: editProfileName,
        dashboardPassword: editDashboardPassword
      });
      const p = await firebaseService.getUserProfile(user.uid);
      setProfile(p);
      setShowProfileModal(false);
    } catch(err) {
      console.error(err);
      alert('Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !profile) return;
    setLoading(true);
    try {
      const inviteId = await firebaseService.createInvitation(profile.uid, inviteEmail);
      if (inviteId) {
        const inviteUrl = `https://creditsync-863590140061.us-west1.run.app/?invite=${inviteId}`;
        await navigator.clipboard.writeText(inviteUrl);
        
        // Send real invitation email
        await emailService.sendInvitation(inviteEmail, profile.displayName || 'Creditor', inviteUrl);
        
        alert(`Invitation link created and copied to clipboard!\n\nEmail invitation has also been sent to: ${inviteEmail}`);
        setShowInviteModal(false);
        setInviteEmail('');
      }
    } catch (err) {
      console.error(err);
      alert("Failed to create invitation.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8FAFC] space-y-8">
        <motion.div 
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }} 
          transition={{ repeat: Infinity, duration: 2 }}
          className="text-indigo-600"
        >
          <CreditCard size={64} />
        </motion.div>
        
        <div className="text-center space-y-2">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] animate-pulse">Initialising Secure Layer</p>
          <button 
            onClick={() => window.location.reload()}
            className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline"
          >
            Taking too long? Reload app
          </button>
        </div>
      </div>
    );
  }

  if (!user) return <LoginView onLogin={setUser} />;

  if (!profile || !profile.role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <motion.div 
          animate={{ rotate: 360 }} 
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="text-indigo-600"
        >
          <RefreshCcw size={32} />
        </motion.div>
      </div>
    );
  }

  if (activeLedger) {
    return <LedgerView ledger={activeLedger} onBack={() => setActiveLedger(null)} profile={profile} />;
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans flex">
      {/* Sidebar Navigation */}
      <AnimatePresence mode="wait">
        {sidebarOpen && window.innerWidth < 768 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 md:hidden"
          />
        )}
      </AnimatePresence>

      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 bg-[#0F172A] text-white transition-all duration-500 ease-in-out flex flex-col shadow-2xl overflow-hidden",
        sidebarOpen ? "w-72 translate-x-0" : "w-20 -translate-x-full md:translate-x-0"
      )}>
        <div className={cn(
          "p-6 flex items-center transition-all duration-500 justify-center"
        )}>
          <div className={cn(
            "flex items-center gap-3 transition-all duration-500 overflow-hidden",
            sidebarOpen ? "opacity-100 w-auto" : "opacity-0 w-0"
          )}>
            <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center text-white shadow-xl shadow-indigo-500/20 shrink-0">
              <CreditCardIcon size={24} />
            </div>
            <span className="font-black text-2xl tracking-tighter whitespace-nowrap">CreditSync</span>
          </div>
        </div>

        <nav className="flex-1 px-4 py-8 space-y-2">
          <NavItem 
            icon={<LayoutDashboard size={20} />}                
            label="Dashboard" 
            active={activeTab === 'dashboard'} 
            collapsed={!sidebarOpen} 
            onClick={() => {
              if (activeTab === 'dashboard') {
                setSidebarOpen(!sidebarOpen);
              } else {
                setActiveTab('dashboard');
                setSidebarOpen(true);
              }
            }}
          />
          {profile?.role === 'creditor' && (
            <NavItem 
              icon={<UsersIcon size={20} />} 
              label="Accounts" 
              active={activeTab === 'accounts'} 
              collapsed={!sidebarOpen} 
              onClick={() => {
                if (activeTab === 'accounts') {
                  setSidebarOpen(!sidebarOpen);
                } else {
                  setActiveTab('accounts');
                  setSidebarOpen(true);
                }
              }}
            />
          )}
          <NavItem 
            icon={<HistoryIcon size={20} />} 
            label="Transaction Log" 
            active={activeTab === 'history'} 
            collapsed={!sidebarOpen} 
            onClick={() => {
              if (activeTab === 'history') {
                setSidebarOpen(!sidebarOpen);
              } else {
                setActiveTab('history');
                setSidebarOpen(true);
              }
            }}
          />
        </nav>

        <div className="p-4 border-t border-white/10 space-y-4">
          <button 
            onClick={() => {
              setEditProfileName(profile.displayName || '');
              setEditDashboardPassword(profile.dashboardPassword || '');
              setShowProfileModal(true);
            }}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all hover:bg-white/5",
              !sidebarOpen && "justify-center px-0"
            )}
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-black text-sm shadow-lg shrink-0">
              {profile.displayName?.charAt(0) || 'U'}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-black truncate text-white">{profile.displayName}</p>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{profile.role}</p>
              </div>
            )}
          </button>
          <button 
            onClick={handleLogout}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all",
              !sidebarOpen && "justify-center px-0"
            )}
          >
            <LogOut size={20} />
            {sidebarOpen && <span className="text-sm font-bold">Sign Out</span>}
          </button>

          {!gmailActive && sidebarOpen && (
            <div className="p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 space-y-3">
              <div className="flex items-center gap-2 text-indigo-400">
                <Mail size={16} />
                <span className="text-[10px] font-black uppercase tracking-widest">Gmail Offline</span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                Connect your Gmail to send automated credit notices from your account.
              </p>
              <button 
                onClick={async () => {
                   await loginWithGoogle();
                   setGmailActive(!!getAccessToken());
                }}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
              >
                Connect Gmail
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className={cn(
        "flex-1 transition-all duration-300 min-w-0 bg-slate-50",
        sidebarOpen ? "md:ml-72" : "md:ml-20"
      )}>
        {/* Top Navbar */}
        <header className="h-20 bg-indigo-900 border-b border-indigo-800 sticky top-0 z-30 px-4 md:px-8 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 text-indigo-300 hover:bg-white/10 rounded-xl transition-colors md:hidden shrink-0"
              aria-label="Toggle Menu"
            >
              <Menu size={24} />
            </button>
            <h1 className="text-xl md:text-2xl font-black text-white tracking-widest uppercase">
              {activeTab === 'dashboard' ? (profile.role === 'creditor' ? 'Creditor Dashboard' : 'Borrower Dashboard') : 
               activeTab === 'accounts' ? 'Accounts' : 'Transaction Log'}
            </h1>
          </div>

          <div className="flex items-center gap-2 md:gap-4 shrink-0">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full border border-emerald-100">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Network Live</span>
            </div>
            {/* Mobile simplified live indicator */}
            <div className="sm:hidden w-3 h-3 bg-emerald-500 rounded-full animate-pulse border-2 border-white shadow-sm" title="Connected" />
            
            <button 
              onClick={() => setShowNotifications(!showNotifications)}
              className="p-2.5 md:p-3 bg-white border border-slate-200 rounded-2xl relative hover:border-slate-300 transition-all group"
            >
              <Bell size={20} className="text-slate-400 group-hover:text-slate-900 transition-colors" />
              {notifications.filter(n => !n.read).length > 0 && (
                <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-indigo-500 rounded-full border-2 border-white" />
              )}
            </button>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="p-4 sm:p-8 max-w-[1400px] mx-auto">
          {activeLedger ? (
            <LedgerView 
              ledger={activeLedger} 
              onBack={() => setActiveLedger(null)} 
              profile={profile!} 
            />
          ) : (
            <>
              {activeTab === 'dashboard' && (
                profile.role === 'borrower' ? (
                  <BorrowerModule 
                    profile={profile} 
                    ledgers={ledgers} 
                    allTransactions={allTransactions}
                    requests={requests}
                    onSelectLedger={setActiveLedger}
                  />
                ) : (
                  <CreditorModule 
                    profile={profile} 
                    ledgers={ledgers} 
                    requests={requests}
                    allTransactions={allTransactions}
                    onSelectLedger={setActiveLedger}
                    onRecordPayment={() => setActiveTab('accounts')}
                    onIssueLoan={() => setActiveTab('accounts')}
                  />
                )
              )}

              {activeTab === 'accounts' && (
                <div className="space-y-8">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                      <h2 className="text-3xl font-black text-slate-900 tracking-tighter">Accounts Directory</h2>
                      <p className="text-slate-500 font-medium text-sm mt-1">Manage all active and pending relations.</p>
                    </div>
                    {profile.role === 'creditor' && (
                      <button 
                        onClick={() => setShowInviteModal(true)}
                        className="bg-indigo-600 text-white px-8 py-4 rounded-[28px] font-black shadow-xl shadow-indigo-600/20 hover:bg-indigo-700 hover:scale-[1.02] transition-all flex items-center justify-center gap-3 group ml-auto"
                      >
                        <UsersIcon size={24} />
                        Invite Borrower
                      </button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {ledgers.length === 0 ? (
                      <div className="col-span-full py-32 text-center space-y-6 opacity-30">
                        <UsersIcon size={80} className="mx-auto text-slate-300" />
                        <div className="space-y-1">
                          <p className="text-2xl font-black text-slate-900 uppercase tracking-tighter">No active accounts</p>
                          <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Start by issuing credit or inviting a borrower</p>
                        </div>
                      </div>
                    ) : (
                      ledgers.map(ledger => (
                        <div 
                          key={ledger.id} 
                          onClick={() => setActiveLedger(ledger)}
                          className="p-6 rounded-[32px] bg-white border border-slate-200 hover:border-indigo-600 hover:shadow-lg transition-all cursor-pointer group flex flex-col justify-between relative overflow-hidden"
                        >
                          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50/50 rounded-bl-[100px] -z-10 transition-all group-hover:bg-indigo-100/50" />
                          <div className="flex flex-col gap-6 w-full relative z-10">
                            <div className="flex items-center gap-4">
                              <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-[20px] flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm">
                                <UsersIcon size={28} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h4 className="text-lg font-black text-slate-900 tracking-tight truncate">{profile.role === 'borrower' ? ledger.creditorName : ledger.borrowerName}</h4>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{profile.role === 'borrower' ? 'Principal Creditor' : 'Active Borrower'}</p>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex flex-col">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Principal</span>
                                <span className="text-sm font-black text-slate-800">R{(ledger.principalBalance || 0).toLocaleString()}</span>
                              </div>
                              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex flex-col">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Interest</span>
                                <span className="text-sm font-black text-slate-800">R{(ledger.interestBalance || 0).toLocaleString()}</span>
                              </div>
                            </div>
                            
                            {(() => {
                              const latestTx = [...allTransactions]
                                .filter(t => t.ledgerId === ledger.id)
                                .sort((a,b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0))[0];
                              
                              if (!latestTx) return <div className="h-[76px]"></div>;
                              
                              return (
                                <div className="bg-indigo-50/30 rounded-2xl p-4 border border-indigo-50/50 flex flex-col gap-2">
                                  <div className="flex justify-between items-center">
                                    <div className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.2em]">Latest Activity</div>
                                    <div className="text-xs font-black text-indigo-600">
                                      {latestTx.type === 'loan' ? '+' : latestTx.type === 'interest' ? '+' : '-'}R{latestTx.amount.toLocaleString()}
                                    </div>
                                  </div>
                                  <div className="text-xs font-bold text-slate-700 truncate">
                                    {latestTx.description}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                          
                          <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-indigo-500 transition-colors">
                              Total Owed
                            </div>
                            <div className="text-2xl font-black text-slate-900 group-hover:text-indigo-600 transition-colors">
                              R{ledger.currentBalance.toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'history' && (
                <div className="space-y-8">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex flex-col gap-1">
                      <h2 className="text-3xl font-black text-slate-900 tracking-tighter">Transaction Log</h2>
                      <p className="text-slate-500 font-medium text-sm">Comprehensive history of all financial activities.</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <select 
                        value={txTypeFilter}
                        onChange={(e) => setTxTypeFilter(e.target.value)}
                        className="bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-indigo-600/20"
                      >
                        <option value="all">All Types</option>
                        <option value="loan">Loans</option>
                        <option value="payment">Payments</option>
                        <option value="interest">Interest</option>
                        <option value="allocation">Allocations</option>
                      </select>
                      <select 
                        value={txAccountFilter}
                        onChange={(e) => setTxAccountFilter(e.target.value)}
                        className="bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-indigo-600/20 max-w-[200px]"
                      >
                        <option value="all">All Accounts</option>
                        {Array.from(new Set(allTransactions.map(tx => tx._ledgerName))).map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm overflow-hidden p-6 sm:p-10">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-separate border-spacing-y-4">
                        <thead>
                          <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            <th className="px-6 py-2">Transaction Type</th>
                            <th className="px-6 py-2">Account</th>
                            <th className="px-6 py-2">Reference</th>
                            <th className="px-6 py-2">Timestamp</th>
                            <th className="px-6 py-2 text-right">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allTransactions.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-20 text-center opacity-20">
                                <HistoryIcon size={64} className="mx-auto" />
                                <p className="text-sm font-black uppercase tracking-widest mt-4">No transactions found</p>
                              </td>
                            </tr>
                          ) : (
                            allTransactions
                              .filter(tx => txTypeFilter === 'all' || tx.type === txTypeFilter)
                              .filter(tx => txAccountFilter === 'all' || tx._ledgerName === txAccountFilter)
                              .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0))
                              .map((tx) => (
                                <tr key={tx.id} className="group hover:bg-slate-50 transition-all rounded-3xl">
                                  <td className="px-6 py-4">
                                    <div className={cn(
                                      "inline-flex items-center gap-2 px-3 py-1.5 rounded-xl font-black text-[10px] uppercase tracking-widest",
                                      tx.type === 'loan' ? "bg-indigo-50 text-indigo-600" :
                                      tx.type === 'payment' ? "bg-emerald-50 text-emerald-600" :
                                      "bg-amber-50 text-amber-600"
                                    )}>
                                      <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", 
                                         tx.type === 'loan' ? "bg-indigo-600" :
                                         tx.type === 'payment' ? "bg-emerald-600" :
                                         "bg-amber-600"
                                      )} />
                                      {tx.type}
                                    </div>
                                  </td>
                                  <td className="px-6 py-4">
                                    <div className="font-black text-slate-900 text-sm">{tx._ledgerName}</div>
                                  </td>
                                  <td className="px-6 py-4">
                                    <div className="font-medium text-slate-500 text-sm max-w-xs truncate">{tx.description}</div>
                                  </td>
                                  <td className="px-6 py-4">
                                    <div className="text-[10px] font-bold text-slate-400">
                                      {formatDateTime(tx.createdAt)}
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <div className={cn(
                                      "font-black text-lg tabular-nums tracking-tighter",
                                      tx.type === 'payment' ? "text-emerald-600" : "text-slate-900"
                                    )}>
                                      {tx.type === 'payment' ? '-' : '+'}{formatCurrency(tx.amount)}
                                    </div>
                                  </td>
                                </tr>
                              ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Invite Modal */}
      <AnimatePresence>
        {showInviteModal && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowInviteModal(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[60]" 
            />
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={() => setShowInviteModal(false)}>
              <motion.div 
                onClick={(e) => e.stopPropagation()}
                initial={{ scale: 0.9, opacity: 0, y: 20 }} 
                animate={{ scale: 1, opacity: 1, y: 0 }} 
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative w-full max-w-md bg-white rounded-[32px] sm:rounded-[40px] shadow-2xl p-6 sm:p-10 space-y-6 sm:space-y-8"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">Invite Borrower</h3>
                  <button onClick={() => setShowInviteModal(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                    <X size={24} className="text-slate-400" />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="p-6 bg-indigo-50 rounded-3xl border border-indigo-100">
                    <p className="text-sm font-bold text-indigo-700 leading-relaxed italic">
                      "Send an unique join link to your borrower. Once they sign up, they'll be automatically linked to your account."
                    </p>
                  </div>

                  <form onSubmit={handleInvite} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Borrower's Email Address</label>
                      <input 
                        type="email" 
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="name@email.com"
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 focus:ring-2 focus:ring-indigo-600 outline-none font-bold"
                        required
                      />
                    </div>
                    <button 
                      type="submit"
                      disabled={loading}
                      className="w-full bg-[#0F172A] text-white py-5 rounded-2xl font-black shadow-xl hover:bg-slate-800 transition-all disabled:opacity-50"
                    >
                      {loading ? 'Creating Invitation...' : 'Copy Invite Link'}
                    </button>
                  </form>
                </div>
              </motion.div>
            </div>

          </>
        )}
      </AnimatePresence>

      {/* Profile Modal */}
      <AnimatePresence>
        {showProfileModal && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowProfileModal(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[60]" 
            />
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={() => setShowProfileModal(false)}>
              <motion.div 
                onClick={(e) => e.stopPropagation()}
                initial={{ scale: 0.9, opacity: 0, y: 20 }} 
                animate={{ scale: 1, opacity: 1, y: 0 }} 
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative w-full max-w-md bg-white rounded-[40px] shadow-xl border border-slate-100 p-8 space-y-6 max-h-[90vh] overflow-y-auto scrollbar-thin"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">Edit Profile</h3>
                  <button onClick={() => setShowProfileModal(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                    <X size={24} className="text-slate-400" />
                  </button>
                </div>
                <form onSubmit={handleUpdateProfile} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Display Name</label>
                    <input 
                      type="text" 
                      value={editProfileName}
                      onChange={(e) => setEditProfileName(e.target.value)}
                      placeholder="Your Name"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 focus:ring-2 focus:ring-indigo-600 outline-none font-bold"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Dashboard Password (Optional)</label>
                    <input 
                      type="password" 
                      value={editDashboardPassword}
                      onChange={(e) => setEditDashboardPassword(e.target.value)}
                      placeholder="Enter to require on open"
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 focus:ring-2 focus:ring-indigo-600 outline-none font-bold"
                    />
                  </div>
                  <button 
                    type="submit"
                    disabled={loading || !editProfileName.trim()}
                    className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black shadow-xl shadow-indigo-600/20 hover:bg-indigo-700 transition-all disabled:opacity-50 mt-4"
                  >
                    {loading ? 'Saving...' : 'Save Changes'}
                  </button>
                  
                  <div className="pt-4 border-t border-slate-100 mt-4">
                    <button 
                      type="button"
                      onClick={async () => {
                        await loginWithGoogle();
                        setGmailActive(!!getAccessToken());
                        alert("Gmail connected successfully!");
                      }}
                      className={cn(
                        "w-full py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2",
                        gmailActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      )}
                    >
                      <Mail size={18} />
                      {gmailActive ? 'Gmail Connected' : 'Connect Gmail'}
                    </button>
                  </div>

                  <div className="pt-4 border-t border-slate-100 mt-4 space-y-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Email Sent Log</label>
                    <div className="max-h-48 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                      {emailLogs.length === 0 ? (
                        <div className="text-center py-6 text-slate-400 text-xs font-bold bg-slate-50 rounded-2xl border border-slate-100">
                          No emails sent yet
                        </div>
                      ) : (
                        emailLogs.map((log) => (
                          <div key={log.id} className="p-3 bg-slate-50 border border-slate-100 rounded-2xl flex flex-col gap-1 text-[11px] hover:bg-slate-100/50 transition-all">
                            <div className="flex items-center justify-between">
                              <span className="font-extrabold text-slate-800 break-all">{log.to}</span>
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider",
                                log.status === 'sent' ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                              )}>
                                {log.status}
                              </span>
                            </div>
                            <div className="font-bold text-slate-600 line-clamp-1">{log.subject}</div>
                            {log.bodyPreview && (
                              <div className="text-slate-400 text-[10px] leading-relaxed line-clamp-2 italic bg-white/70 p-2 rounded-xl border border-slate-100/50 mt-1">
                                {log.bodyPreview}
                              </div>
                            )}
                            {log.status === 'failed' && log.errorMessage && (
                              <div className="text-rose-600 font-bold text-[9px] bg-rose-50/70 border border-rose-100/50 rounded-xl p-2 mt-1 whitespace-pre-wrap break-words">
                                Reason: {log.errorMessage}
                              </div>
                            )}
                            <div className="text-[9px] text-slate-400 font-bold mt-1">
                              {log.sentAt ? formatDateTime(log.sentAt) : 'Just now'}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </form>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* Notifications Drawer */}
      <AnimatePresence>
        {showNotifications && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowNotifications(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50" 
            />
            <motion.div 
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              className="fixed inset-y-0 right-0 w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">Notifications</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Updates on your activity</p>
                    {notifications.filter((n: any) => !n.read).length > 0 && (
                      <button 
                        onClick={() => {
                          notifications.filter((n: any) => !n.read).forEach((n: any) => firebaseService.markNotificationRead(n.id));
                        }}
                        className="text-[9px] font-black text-indigo-600 uppercase tracking-widest hover:text-indigo-700"
                      >
                        Mark all as read
                      </button>
                    )}
                    {notifications.length > 0 && (
                      <button 
                        onClick={() => firebaseService.deleteAllNotifications(profile!.uid)}
                        className="text-[9px] font-black text-rose-600 uppercase tracking-widest hover:text-rose-700 ml-3"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                </div>
                <button onClick={() => setShowNotifications(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {notifications.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center opacity-20 py-20">
                    <Bell size={48} />
                    <p className="text-[10px] font-black uppercase tracking-widest mt-4">No notifications</p>
                  </div>
                ) : (
                  notifications.map((note: any) => (
                    <div 
                      key={note.id} 
                      onClick={() => !note.read && firebaseService.markNotificationRead(note.id)}
                      className={cn(
                        "p-5 rounded-3xl border transition-all cursor-pointer relative",
                        note.read ? "bg-slate-50 border-slate-100 opacity-60" : "bg-white border-indigo-100 shadow-sm hover:shadow-md"
                      )}
                    >
                      {!note.read && (
                        <div className="absolute top-6 right-6 w-2 h-2 bg-indigo-500 rounded-full" />
                      )}
                      <div className="flex items-center justify-between mb-2">
                        <span className={cn(
                          "px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest",
                          note.type === 'success' ? "bg-emerald-50 text-emerald-600" :
                          note.type === 'warning' ? "bg-amber-50 text-amber-600" :
                          "bg-indigo-50 text-indigo-600"
                        )}>
                          {note.type || 'Update'}
                        </span>
                        <span className="text-[9px] font-bold text-slate-400">
                          {note.createdAt ? format(note.createdAt.toDate(), 'HH:mm') : ''}
                        </span>
                      </div>
                      <p className="text-sm font-black text-slate-900">{note.title}</p>
                      <p className="text-xs font-medium text-slate-500 leading-relaxed">{note.message}</p>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ icon, label, active = false, collapsed = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, collapsed?: boolean, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
      "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all group relative",
      active ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" : "text-slate-400 hover:text-white hover:bg-white/5",
      collapsed && "justify-center px-0"
    )}>
      <div className={cn(active ? "text-white" : "group-hover:text-indigo-400 transition-colors")}>
        {icon}
      </div>
      {!collapsed && <span className="text-sm font-bold tracking-tight">{label}</span>}
      {active && !collapsed && <div className="absolute right-4 w-1.5 h-1.5 bg-white rounded-full" />}
    </button>
  );
}
