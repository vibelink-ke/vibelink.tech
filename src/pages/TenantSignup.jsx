import React, { useState } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Zap, CheckCircle, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

export default function TenantSignup() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    company_name: '',
    admin_name: '',
    admin_email: '',
    phone: '',
    address: '',
    city: '',
    country: '',
    password: '',
    confirm_password: '',
    is_demo: false,
  });

  const createTenantMutation = useMutation({
    mutationFn: async (data) => {
      return await vibelink.auth.registerTenant(data);
    },
    onSuccess: () => {
      setStep(3);
      toast.success('Account created successfully! Redirecting to your dashboard...');
      setTimeout(() => {
        window.location.href = '/login';
      }, 3000);
    },
    onError: (error) => {
      toast.error('Failed to create account: ' + error.message);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (step === 2) {
      if (formData.password !== formData.confirm_password) {
        toast.error("Passwords do not match");
        return;
      }
      createTenantMutation.mutate(formData);
    } else {
      setStep(step + 1);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-slate-900 dark:text-slate-50">VIBELINK</h1>
                <p className="text-xs text-slate-500">ISP Management Platform</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {step < 3 ? (
          <>
            {/* Progress Steps */}
            <div className="flex items-center justify-center mb-8">
              {[1, 2].map((s, i) => (
                <React.Fragment key={s}>
                  <div className={`flex items-center justify-center w-10 h-10 rounded-full font-semibold ${
                    step >= s ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'
                  }`}>
                    {step > s ? <CheckCircle className="w-5 h-5" /> : s}
                  </div>
                  {i < 1 && (
                    <div className={`w-24 h-1 mx-2 ${step > s ? 'bg-indigo-600' : 'bg-slate-200'}`} />
                  )}
                </React.Fragment>
              ))}
            </div>

            <Card className="max-w-2xl mx-auto">
              <CardHeader>
                <CardTitle>
                  {step === 1 && 'Company Information'}
                  {step === 2 && 'Account Details'}
                </CardTitle>
                <CardDescription>
                  {step === 1 && 'Tell us about your ISP company'}
                  {step === 2 && 'Create your admin account'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit}>
                  {/* Step 1: Company Info */}
                  {step === 1 && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Company Name *</Label>
                        <Input
                          value={formData.company_name}
                          onChange={(e) => setFormData({...formData, company_name: e.target.value})}
                          placeholder="Your ISP Company Name"
                          required
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Phone *</Label>
                          <Input
                            value={formData.phone}
                            onChange={(e) => setFormData({...formData, phone: e.target.value})}
                            placeholder="+254..."
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Country *</Label>
                          <Input
                            value={formData.country}
                            onChange={(e) => setFormData({...formData, country: e.target.value})}
                            placeholder="Kenya"
                            required
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>City *</Label>
                        <Input
                          value={formData.city}
                          onChange={(e) => setFormData({...formData, city: e.target.value})}
                          placeholder="Nairobi"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Address</Label>
                        <Input
                          value={formData.address}
                          onChange={(e) => setFormData({...formData, address: e.target.value})}
                          placeholder="Office address"
                        />
                      </div>
                    </div>
                  )}

                  {/* Step 2: Account Details */}
                  {step === 2 && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Admin Name *</Label>
                        <Input
                          value={formData.admin_name}
                          onChange={(e) => setFormData({...formData, admin_name: e.target.value})}
                          placeholder="John Doe"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Admin Email *</Label>
                        <Input
                          type="email"
                          value={formData.admin_email}
                          onChange={(e) => setFormData({...formData, admin_email: e.target.value})}
                          placeholder="admin@yourisp.com"
                          required
                        />
                        <p className="text-xs text-slate-500">This will be your login email</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Password *</Label>
                        <Input
                          type="password"
                          value={formData.password}
                          onChange={(e) => setFormData({...formData, password: e.target.value})}
                          placeholder="Create a strong password"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Confirm Password *</Label>
                        <Input
                          type="password"
                          value={formData.confirm_password}
                          onChange={(e) => setFormData({...formData, confirm_password: e.target.value})}
                          placeholder="Confirm your password"
                          required
                        />
                      </div>
                      <div className="flex items-center space-x-2 pt-2">
                        <Checkbox 
                          id="is_demo" 
                          checked={formData.is_demo}
                          onCheckedChange={(checked) => setFormData({...formData, is_demo: checked})}
                        />
                        <label
                          htmlFor="is_demo"
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-slate-700 dark:text-slate-300"
                        >
                          Create as Demo Account (Expires in 2 hours)
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between gap-3 pt-6">
                    {step > 1 && (
                      <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                        Back
                      </Button>
                    )}
                    <Button 
                      type="submit" 
                      className="ml-auto bg-indigo-600 hover:bg-indigo-700"
                      disabled={createTenantMutation.isPending}
                    >
                      {step === 2 ? (
                        createTenantMutation.isPending ? 'Creating...' : 'Start Free Trial'
                      ) : (
                        <>
                          Continue <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </>
        ) : (
          /* Success Screen */
          <Card className="max-w-2xl mx-auto text-center">
            <CardContent className="pt-12 pb-12">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', duration: 0.5 }}
                className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center mx-auto mb-6"
              >
                <CheckCircle className="w-10 h-10 text-white" />
              </motion.div>
              <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-50 mb-3">Welcome to VIBELINK!</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-6">
                Your account has been created successfully. We've sent login instructions to <strong>{formData.admin_email}</strong>
              </p>
              <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-200 mb-6">
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  <strong className="text-indigo-600">billing.vibelink.co.ke/login</strong>
                </p>
              </div>
              <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={() => {
                window.location.href = '/login';
              }}>
                Go to Login
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}