import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { vibelink } from '@/api/vibelinkClient';

export default function OnboardingStep3({ data, tenantId, onBack, onComplete }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleComplete = async () => {
    setIsSubmitting(true);
    setError('');

    try {
      // Update tenant with all details
      await vibelink.entities.Tenant.update(tenantId, {
        company_name: data.company_name,
        subdomain: data.subdomain,
        admin_name: data.admin_name,
        admin_email: data.admin_email,
        phone: data.phone,
        city: data.city,
        country: data.country,
        onboarded: true,
        status: 'active'
      });

      onComplete();
    } catch (err) {
      setError(err.message || 'Failed to complete setup');
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            Review Your Setup
          </CardTitle>
          <CardDescription>
            Verify your information before completing the setup
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="border-l-4 border-indigo-500 pl-4">
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Company Name</p>
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">{data.company_name}</p>
            </div>

            <div className="border-l-4 border-indigo-500 pl-4">
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Subdomain</p>
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">https://{data.subdomain}.vibelink.com</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="border-l-4 border-indigo-500 pl-4">
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">City</p>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{data.city || '-'}</p>
              </div>
              <div className="border-l-4 border-indigo-500 pl-4">
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Country</p>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{data.country || '-'}</p>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900 font-semibold mb-2">👤 Admin Account</p>
              <div className="space-y-2 text-sm text-blue-800">
                <p><strong>Name:</strong> {data.admin_name}</p>
                <p><strong>Email:</strong> {data.admin_email}</p>
                <p><strong>Phone:</strong> {data.phone}</p>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-green-900">
                  <p className="font-semibold mb-1">Trial Period Activated</p>
                  <p>Your 30-day free trial is now active. Full access to all features.</p>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button onClick={onBack} variant="outline" className="w-full" disabled={isSubmitting}>
              Back
            </Button>
            <Button
              onClick={handleComplete}
              className="w-full bg-green-600 hover:bg-green-700"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Setting up...' : 'Complete Setup'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}