import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { vibelink } from '@/api/vibelinkClient';
import { AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import OnboardingProgress from '../components/onboarding/OnboardingProgress';
import OnboardingStep1 from '../components/onboarding/OnboardingStep1';
import OnboardingStep2 from '../components/onboarding/OnboardingStep2';
import OnboardingStep3 from '../components/onboarding/OnboardingStep3';
import { useAuth } from '@/lib/AuthContext';

const steps = [
  { id: 'company', label: 'Company Info' },
  { id: 'admin', label: 'Admin Setup' },
  { id: 'review', label: 'Review' }
];

export default function TenantOnboarding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tenantId: ctxTenantId, updateMe } = useAuth();
  const tenantId = searchParams.get('tenant_id') || ctxTenantId;

  const [currentStep, setCurrentStep] = useState(0);
  const [tenant, setTenant] = useState(null);
  const [formData, setFormData] = useState({
    company_name: '',
    subdomain: '',
    city: '',
    country: '',
    admin_name: '',
    admin_email: '',
    phone: ''
  });

  useEffect(() => {
    if (!tenantId) {
      navigate('/Register');
      return;
    }

    const loadTenant = async () => {
      const t = await vibelink.entities.Tenant.get(tenantId);
      if (t) {
        setTenant(t);
        setFormData({
          company_name: t.company_name || '',
          subdomain: t.subdomain || '',
          city: t.city || '',
          country: t.country || '',
          admin_name: t.admin_name || '',
          admin_email: t.admin_email || '',
          phone: t.phone || ''
        });
      } else {
        // Handle case where tenant lookup fails
        setTenant({});
      }
    };
    loadTenant();
  }, [tenantId, navigate]);

  const handleStep1Next = (data) => {
    setFormData({ ...formData, ...data });
    setCurrentStep(1);
  };

  const handleStep2Next = (data) => {
    setFormData({ ...formData, ...data });
    setCurrentStep(2);
  };

  const handleBack = () => {
    setCurrentStep(Math.max(0, currentStep - 1));
  };

  const handleComplete = async () => {
    try {
      // Mark onboarding as completed for this user/tenant
      await updateMe({ onboarding_completed: true });
      
      // Update tenant info with the final form data
      await vibelink.entities.Tenant.update(tenantId, {
        ...formData,
        onboarding_completed_at: new Date().toISOString()
      });

      toast.success('Setup complete! Welcome aboard.');
      
      // Show success and redirect to dashboard
      setTimeout(() => {
        navigate('/');
      }, 1500);
    } catch (error) {
      toast.error('Failed to save settings: ' + error.message);
    }
  };

  if (!tenant) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-900 mb-3">
            Welcome to VIBELINK
          </h1>
          <p className="text-lg text-slate-600">
            Let's get your ISP management platform set up in just a few minutes
          </p>
        </div>

        {/* Progress */}
        <div className="mb-12">
          <OnboardingProgress
            currentStep={currentStep}
            totalSteps={steps.length}
            steps={steps}
          />
        </div>

        {/* Steps */}
        <AnimatePresence mode="wait">
          {currentStep === 0 && (
            <OnboardingStep1
              key="step1"
              data={formData}
              onNext={handleStep1Next}
            />
          )}
          {currentStep === 1 && (
            <OnboardingStep2
              key="step2"
              data={formData}
              onNext={handleStep2Next}
              onBack={handleBack}
            />
          )}
          {currentStep === 2 && (
            <OnboardingStep3
              key="step3"
              data={formData}
              tenantId={tenantId}
              onBack={handleBack}
              onComplete={handleComplete}
            />
          )}
        </AnimatePresence>

        {/* Footer */}
        <div className="text-center mt-12 text-sm text-slate-600">
          <p>Questions? Email us at <a href="mailto:support@vibelink.com" className="text-indigo-600 hover:underline">support@vibelink.com</a></p>
        </div>
      </div>
    </div>
  );
}