import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mail, Lock, Zap, ArrowRight, ArrowLeft, Loader2, PhoneCall } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!email) {
      toast({ title: "Email Required", description: "Please enter your email to reset your password.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    // Simulate API call for password reset
    setTimeout(() => {
      toast({
        title: "Reset Link Sent",
        description: "If an account exists, a password reset link has been sent to your email.",
      });
      setIsLoading(false);
      setIsForgotPassword(false);
    }, 1500);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isForgotPassword) {
      return handleResetPassword(e);
    }
    setIsLoading(true);
    try {
      await login(email, password);
      toast({
        title: "Welcome to VIBELINK",
        description: "Authenticated successfully.",
      });
      navigate('/');
    } catch (error) {
      toast({
        title: "Authentication Failed",
        description: "Please check your credentials and try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Dynamic Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-indigo-500/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md relative"
      >
        <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl">
          {/* Logo & Header */}
          <div className="flex flex-col items-center mb-8">
            <motion.div
              whileHover={{ rotate: 360, scale: 1.1 }}
              transition={{ duration: 0.8, type: "spring" }}
              className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-4"
            >
              <Zap className="w-8 h-8 text-white fill-white/20" />
            </motion.div>
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
              VIBELINK
            </h1>
            <p className="text-slate-500 mt-2 text-center">
              Enter your credentials to access the ISP portal
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-300 ml-1">Email Address</Label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                  <Mail className="h-4 w-4" />
                </div>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@skybridge.co.ke"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-600 focus:border-indigo-500 focus:ring-indigo-500/20 rounded-xl py-6 transition-all"
                  required
                />
              </div>
            </div>

            {!isForgotPassword && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2"
              >
                <div className="flex items-center justify-between ml-1">
                  <Label htmlFor="password" className="text-slate-300">Password</Label>
                  <button 
                    type="button" 
                    onClick={() => setIsForgotPassword(true)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    Forgot?
                  </button>
                </div>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                    <Lock className="h-4 w-4" />
                  </div>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-600 focus:border-indigo-500 focus:ring-indigo-500/20 rounded-xl py-6 transition-all"
                    required={!isForgotPassword}
                  />
                </div>
              </motion.div>
            )}

            {!isForgotPassword ? (
              <Button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold py-6 rounded-xl shadow-lg shadow-indigo-600/20 transition-all active:scale-[0.98] group mt-4"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </Button>
            ) : (
              <div className="space-y-4 pt-2">
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold py-6 rounded-xl shadow-lg shadow-indigo-600/20 transition-all active:scale-[0.98] group"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      Send Reset Link
                      <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </Button>
                
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsForgotPassword(false)}
                  className="w-full text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl py-6 transition-all group"
                >
                  <ArrowLeft className="mr-2 w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                  Back to Sign In
                </Button>
              </div>
            )}
          </form>

          {/* Footer */}
          <div className="mt-8 text-center border-t border-slate-800 pt-6 space-y-4">
            <div>
              <p className="text-slate-400 mb-2 font-medium">Need help accessing your account?</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-sm">
                <a 
                  href="mailto:support@skybridge.co.ke" 
                  className="flex items-center text-slate-300 hover:text-indigo-400 transition-colors px-3 py-2 rounded-lg hover:bg-slate-800/50"
                >
                  <Mail className="w-4 h-4 mr-2" />
                  support@skybridge.co.ke
                </a>
                <a 
                  href="tel:+254700000000" 
                  className="flex items-center text-slate-300 hover:text-indigo-400 transition-colors px-3 py-2 rounded-lg hover:bg-slate-800/50"
                >
                  <PhoneCall className="w-4 h-4 mr-2" />
                  +254 700 000 000
                </a>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
