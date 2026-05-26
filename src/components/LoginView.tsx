import React, { useState } from 'react';
import { 
  ShieldCheck, 
  ArrowRight, 
  AlertCircle,
  Lock,
  Mail,
  Zap,
  User,
  KeyRound,
  ChevronRight,
  Shield
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { firebaseService } from '../services/firebaseService';
import { cn } from '../lib/utils';

interface LoginViewProps {
  onLogin: (user: any) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
  const [view, setView] = useState<'landing' | 'auth'>('landing');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'borrower' | 'creditor'>('borrower');
  const [authMethod, setAuthMethod] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError('');
    try {
      localStorage.setItem('preferredRole', role);
      const user = await firebaseService.signInWithGoogle();
      if (user) onLogin(user);
    } catch (err: any) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAndPasswordAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (authMethod === 'signin') {
        const user = await firebaseService.signInWithEmail(email, password);
        if (user) onLogin(user);
      } else {
        if (!displayName) {
          throw new Error('Please enter your name.');
        }
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }
        const assignedRole = role;
        const user = await firebaseService.signUpWithEmail(email, password, displayName, assignedRole);
        if (user) onLogin(user);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Authentication failed. Please check password and connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-6 relative overflow-hidden">
      {/* Abstract Background Decor */}
      <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-indigo-500/10 rounded-full blur-[120px] animate-pulse-slow" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-emerald-500/10 rounded-full blur-[120px] animate-pulse-slow" />
      
      <AnimatePresence mode="wait">
        {view === 'landing' && (
          <motion.div 
            key="landing"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-xl w-full text-center space-y-10 relative z-10"
          >
            <div className="space-y-8">
              <div className="w-16 h-16 bg-white/[0.03] rounded-2xl flex items-center justify-center mx-auto backdrop-blur-xl border border-white/10 shadow-xl transition-all hover:border-indigo-500/30">
                <Zap size={32} className="text-indigo-400" />
              </div>
              
              <div className="space-y-4">
                <h1 className="text-5xl font-extrabold text-white tracking-tighter sm:text-6xl">
                  Credit<span className="text-indigo-400">Sync</span>
                </h1>
                
                <div className="hidden md:flex items-center justify-center gap-x-2.5 text-sm font-medium tracking-wide text-slate-400 border border-white/5 bg-white/[0.01] backdrop-blur-md px-5 py-2.5 rounded-full mx-auto max-w-max shadow-inner">
                  <span>Connect your <span className="text-indigo-400 font-semibold">ledgers</span></span>
                  <span className="text-slate-700 font-black text-xs select-none">•</span>
                  <span>sync <span className="text-emerald-400 font-semibold">credit balances</span></span>
                  <span className="text-slate-700 font-black text-xs select-none">•</span>
                  <span>and automate <span className="text-cyan-400 font-semibold">reminders</span></span>
                </div>
                
                <p className="md:hidden text-xs font-medium text-slate-400 leading-relaxed max-w-xs mx-auto">
                  Connect your <span className="text-indigo-400 font-bold">ledgers</span>, sync <span className="text-emerald-400 font-bold">credit balances</span>, and automate <span className="text-cyan-400 font-bold">reminders</span>.
                </p>
              </div>
            </div>

            <button 
              onClick={() => {
                setError('');
                setView('auth');
              }}
              className="group bg-white text-slate-900 px-8 py-4 rounded-2xl font-bold text-sm hover:bg-slate-50 transition-all shadow-lg hover:shadow-indigo-500/10 hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2.5 mx-auto"
            >
              Sign In
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </motion.div>
        )}

        {view === 'auth' && (
          <motion.div 
            key="auth"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-md w-full bg-white/5 backdrop-blur-2xl rounded-[48px] p-10 border border-white/10 shadow-2xl relative z-10"
          >
            <div className="text-center space-y-4 mb-6">
              <div className={cn(
                "w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-xl transition-all duration-500",
                authMethod === 'signin' ? "bg-indigo-500 shadow-indigo-500/20" : "bg-emerald-500 shadow-emerald-500/20"
              )}>
                {authMethod === 'signin' ? <Zap size={32} className="text-white" fill="currentColor" /> : <ShieldCheck size={32} className="text-white" />}
              </div>
              
              <div>
                <h3 className="text-2xl font-black text-white tracking-tight">
                  {authMethod === 'signin' ? 'Welcome Back' : 'Create Secure Profile'}
                </h3>
                <p className="text-xs text-slate-400 font-medium mt-1">
                  {authMethod === 'signin' ? 'Verify password to access synchronized ledgers.' : 'Join the instant credit synchronization network.'}
                </p>
              </div>

              {/* Enhanced Tab toggler between Sign In and Sign Up */}
              <div className="grid grid-cols-2 p-1 bg-white/5 border border-white/5 rounded-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMethod('signin');
                    setError('');
                  }}
                  className={cn(
                    "py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
                    authMethod === 'signin' 
                      ? "bg-white text-slate-900 shadow-lg" 
                      : "text-slate-400 hover:text-white"
                  )}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMethod('signup');
                    setError('');
                  }}
                  className={cn(
                    "py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
                    authMethod === 'signup' 
                      ? "bg-emerald-500 text-white shadow-lg" 
                      : "text-slate-400 hover:text-white"
                  )}
                >
                  Register
                </button>
              </div>
            </div>

            <div className="space-y-6">
              {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-2xl text-xs font-bold text-center">
                  {error}
                </div>
              )}

              {/* 1. Preferred Role / Account Type Selection */}
              <div className="space-y-2">
                <div className="flex justify-between items-center pl-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]">Preferred Role / Account Type</label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setRole('borrower')}
                    className={cn(
                      "p-3 rounded-xl border text-center transition-all flex items-center justify-center gap-2",
                      role === 'borrower' 
                        ? "bg-indigo-500/20 border-indigo-500 text-white font-black" 
                        : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
                    )}
                  >
                    <User size={14} className={role === 'borrower' ? 'text-indigo-400' : ''} />
                    <span className="text-[10px] uppercase tracking-wider">Borrower</span>
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => setRole('creditor')}
                    className={cn(
                      "p-3 rounded-xl border text-center transition-all flex items-center justify-center gap-2",
                      role === 'creditor' 
                        ? "bg-emerald-500/20 border-emerald-500 text-white font-black" 
                        : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
                    )}
                  >
                    <Shield size={14} className={role === 'creditor' ? 'text-emerald-400' : ''} />
                    <span className="text-[10px] uppercase tracking-wider">Creditor</span>
                  </button>
                </div>
              </div>

              {/* 2. Google Authentication */}
              <button
                onClick={handleGoogleAuth}
                disabled={loading}
                className="w-full bg-white/10 border border-white/10 text-white py-4 rounded-2xl font-bold hover:bg-white/20 transition-all flex items-center justify-center gap-3 disabled:opacity-50 text-sm shadow-xl"
              >
                Sign in with Google
              </button>

              <div className="flex items-center gap-4 my-2">
                <div className="h-px bg-white/10 flex-1"></div>
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">or use credentials</span>
                <div className="h-px bg-white/10 flex-1"></div>
              </div>

              {/* 3. Traditional Email/Password Form */}
              <form onSubmit={handleEmailAndPasswordAuth} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">Email Address</label>
                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" size={16} />
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@email.com"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 pl-12 focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-white text-sm transition-all"
                    />
                  </div>
                </div>

                {/* Sign Up Mode: Full Name */}
                {authMethod === 'signup' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">Full Name</label>
                    <div className="relative group">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" size={16} />
                      <input
                        required
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="John Doe"
                        className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 pl-12 focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-white text-sm transition-all"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">Secure Password</label>
                  <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" size={16} />
                    <input
                      required
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 pl-12 focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-white text-sm transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={cn(
                    "w-full py-4 rounded-2xl font-black shadow-lg transition-all flex items-center justify-center gap-2 uppercase tracking-wider text-xs border border-white/10 disabled:opacity-50 text-slate-900 mt-2",
                    authMethod === 'signin' ? "bg-white hover:bg-slate-100" : "bg-emerald-400 hover:bg-emerald-500 text-white"
                  )}
                >
                  {loading ? 'Processing secure layer...' : (
                    <>
                      {authMethod === 'signin' ? 'Verify & Access' : 'Create Secure Profile'}
                      <ChevronRight size={16} />
                    </>
                  )}
                </button>
              </form>

              <button 
                onClick={() => {
                  setError('');
                  setView('landing');
                }}
                className="text-[10px] text-slate-500 font-black uppercase tracking-widest hover:text-white transition-colors w-full text-center block pt-2"
              >
                Go Back
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
