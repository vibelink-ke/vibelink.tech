import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import PageHeader from '@/components/shared/PageHeader';
import CustomerOnboardingWizard from '@/components/onboarding/CustomerOnboardingWizard.jsx';

export default function CustomerOnboarding() {
  const [currentCustomerId, setCurrentCustomerId] = useState(null);

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => vibelink.entities.Customer.list(),
  });

  const { data: servicePlans = [] } = useQuery({
    queryKey: ['service-plans'],
    queryFn: () => vibelink.entities.ServicePlan.list(),
  });

  const { data: mikrotiks = [] } = useQuery({
    queryKey: ['mikrotiks'],
    queryFn: () => vibelink.entities.Mikrotik?.list?.() || Promise.resolve([]),
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <PageHeader
          title="Customer Onboarding"
          description="Complete setup for new customers with guided steps"
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <CustomerOnboardingWizard
            customers={customers}
            servicePlans={servicePlans}
            mikrotiks={mikrotiks}
            onCustomerSelect={setCurrentCustomerId}
            selectedCustomerId={currentCustomerId}
          />
        </motion.div>
      </div>
    </div>
  );
}