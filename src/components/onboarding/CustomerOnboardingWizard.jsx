import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, ChevronRight, ChevronLeft, Users } from 'lucide-react';
import { toast } from 'sonner';
import OnboardingStep1ServicePlan from './OnboardingStep1ServicePlan.jsx';
import OnboardingStep2Network from './OnboardingStep2Network.jsx';
import OnboardingStep3Billing from './OnboardingStep3Billing.jsx';
import OnboardingStep4Review from './OnboardingStep4Review.jsx';

export default function CustomerOnboardingWizard({
  customers = [],
  servicePlans = [],
  mikrotiks = [],
  onCustomerSelect,
  selectedCustomerId,
}) {
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [formData, setFormData] = useState({
    plan_id: '',
    plan_name: '',
    monthly_rate: '',
    ip_address: '',
    mac_address: '',
    mikrotik_id: '',
    mikrotik_name: '',
    billing_cycle_day: '1',
  });

  const { data: selectedCustomerData } = useQuery({
    queryKey: ['customer', selectedCustomerId],
    queryFn: () => vibelink.entities.Customer.filter({ customer_id: selectedCustomerId }),
    enabled: !!selectedCustomerId,
  });

  const updateCustomerMutation = useMutation({
    mutationFn: (data) => vibelink.entities.Customer.update(selectedCustomer.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', selectedCustomerId] });
      toast.success('Customer setup completed successfully!');
      handleReset();
    },
  });

  const handleCustomerSelect = (customerId) => {
    onCustomerSelect?.(customerId);
    const customer = customers.find(c => c.customer_id === customerId);
    setSelectedCustomer(customer);
    setCurrentStep(0);
    resetForm();
  };

  const resetForm = () => {
    setFormData({
      plan_id: '',
      plan_name: '',
      monthly_rate: '',
      ip_address: '',
      mac_address: '',
      mikrotik_id: '',
      mikrotik_name: '',
      billing_cycle_day: '1',
    });
  };

  const handleReset = () => {
    setSelectedCustomer(null);
    onCustomerSelect?.(null);
    resetForm();
    setCurrentStep(0);
  };

  const handleNext = () => {
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async () => {
    if (!selectedCustomer) return;

    const updateData = {
      status: 'active',
      plan_id: formData.plan_id,
      plan_name: formData.plan_name,
      monthly_rate: parseFloat(formData.monthly_rate),
      ip_address: formData.ip_address,
      mac_address: formData.mac_address,
      mikrotik_id: formData.mikrotik_id,
      mikrotik_name: formData.mikrotik_name,
      billing_cycle_day: parseInt(formData.billing_cycle_day),
      installation_date: new Date().toISOString().split('T')[0],
    };

    updateCustomerMutation.mutate(updateData);
  };

  const steps = [
    { title: 'Service Plan', description: 'Select and configure service plan' },
    { title: 'Network Details', description: 'Configure IP and network settings' },
    { title: 'Billing Info', description: 'Review billing cycle and rates' },
    { title: 'Review & Confirm', description: 'Confirm all details' },
  ];

  const progressPercentage = ((currentStep + 1) / steps.length) * 100;

  if (!selectedCustomer) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Select Customer to Onboard
          </CardTitle>
          <CardDescription>
            Choose a pending customer to complete their setup
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={selectedCustomerId || ''} onValueChange={handleCustomerSelect}>
            <SelectTrigger>
              <SelectValue placeholder="Select a customer..." />
            </SelectTrigger>
            <SelectContent>
              {customers
                .filter(c => c.status === 'pending')
                .map(customer => (
                  <SelectItem key={customer.id} value={customer.customer_id}>
                    {customer.full_name} ({customer.email})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {customers.filter(c => c.status === 'pending').length === 0 && (
            <div className="text-center py-8">
              <p className="text-slate-500">No pending customers available</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Customer Info Card */}
      <Card className="bg-gradient-to-br from-indigo-50 to-purple-50 border-indigo-200">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{selectedCustomer.full_name}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">{selectedCustomer.email}</p>
              <Badge className="mt-2">{selectedCustomer.status}</Badge>
            </div>
            <Button variant="outline" size="sm" onClick={handleReset}>
              Change Customer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Progress */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50">Setup Progress</h3>
          <span className="text-sm text-slate-600 dark:text-slate-400">{currentStep + 1} of {steps.length}</span>
        </div>
        <Progress value={progressPercentage} />
        
        {/* Step Indicators */}
        <div className="grid grid-cols-4 gap-2">
          {steps.map((step, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg text-center text-xs transition-all ${
                idx === currentStep
                  ? 'bg-indigo-600 text-white'
                  : idx < currentStep
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              <div className="font-semibold">{step.title}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <Card>
        <CardHeader>
          <CardTitle>{steps[currentStep].title}</CardTitle>
          <CardDescription>{steps[currentStep].description}</CardDescription>
        </CardHeader>
        <CardContent>
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              {currentStep === 0 && (
                <OnboardingStep1ServicePlan
                  servicePlans={servicePlans}
                  formData={formData}
                  setFormData={setFormData}
                />
              )}
              {currentStep === 1 && (
                <OnboardingStep2Network
                  mikrotiks={mikrotiks}
                  formData={formData}
                  setFormData={setFormData}
                />
              )}
              {currentStep === 2 && (
                <OnboardingStep3Billing
                  formData={formData}
                  setFormData={setFormData}
                />
              )}
              {currentStep === 3 && (
                <OnboardingStep4Review
                  formData={formData}
                  servicePlans={servicePlans}
                  mikrotiks={mikrotiks}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button
          variant="outline"
          onClick={handlePrevious}
          disabled={currentStep === 0}
        >
          <ChevronLeft className="w-4 h-4 mr-2" />
          Previous
        </Button>

        <div className="flex gap-3">
          <Button variant="outline" onClick={handleReset}>
            Cancel
          </Button>
          {currentStep < 3 ? (
            <Button onClick={handleNext} className="bg-indigo-600 hover:bg-indigo-700">
              Next
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleComplete}
              disabled={updateCustomerMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              {updateCustomerMutation.isPending ? 'Completing...' : 'Complete Setup'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}