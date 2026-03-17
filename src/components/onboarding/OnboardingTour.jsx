import React, { useState, useEffect } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { Button } from '@/components/ui/button';
import { ChevronRight, ChevronLeft, X } from 'lucide-react';
import { motion } from 'framer-motion';

const TOUR_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to VIBELINK!',
    description: 'Let\'s take a quick tour to get you up to speed with the key features.',
    target: null,
    position: 'center',
  },
  {
    id: 'dashboard',
    title: 'Dashboard Overview',
    description: 'Your dashboard shows key metrics and analytics about your ISP business at a glance.',
    target: '[data-tour="dashboard"]',
    position: 'bottom',
  },
  {
    id: 'sidebar-nav',
    title: 'Navigation Menu',
    description: 'Use the sidebar to navigate between different sections like Customers, Billing, Support, and more.',
    target: '[data-tour="sidebar"]',
    position: 'right',
  },
  {
    id: 'notifications',
    title: 'Notification Center',
    description: 'Get real-time alerts for important events like ticket assignments, outages, and billing reminders.',
    target: '[data-tour="notifications"]',
    position: 'bottom',
  },
  {
    id: 'roles-management',
    title: 'Role Management',
    description: 'Under Administration > Roles, you can manage custom roles and permissions for your team.',
    target: null,
    position: 'center',
  },
  {
    id: 'complete',
    title: 'You\'re All Set!',
    description: 'You\'re ready to start managing your ISP business. Click "Done" to close this tour.',
    target: null,
    position: 'center',
  },
];

export default function OnboardingTour({ user, updateMe, onComplete }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const step = TOUR_STEPS[currentStep];

  useEffect(() => {
    // Show tour if user hasn't completed it
    if (user && !user.onboarding_completed) {
      setTimeout(() => setIsVisible(true), 500);
    }
  }, [user]);

  useEffect(() => {
    // Calculate position of target element
    if (step.target) {
      const element = document.querySelector(step.target);
      if (element) {
        const rect = element.getBoundingClientRect();
        let top = rect.top + window.scrollY;
        let left = rect.left + window.scrollX;

        if (step.position === 'bottom') {
          top = rect.bottom + window.scrollY + 10;
          left = rect.left + window.scrollX + rect.width / 2;
        } else if (step.position === 'right') {
          top = rect.top + window.scrollY + rect.height / 2;
          left = rect.right + window.scrollX + 10;
        } else if (step.position === 'top') {
          top = rect.top + window.scrollY - 10;
          left = rect.left + window.scrollX + rect.width / 2;
        }

        setPosition({ top, left });
      }
    }
  }, [currentStep, step.target]);

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async () => {
    setIsVisible(false);
    // Mark onboarding as complete
    if (user && !user.onboarding_completed) {
      if (updateMe) {
        await updateMe({ onboarding_completed: true });
      } else {
        await vibelink.auth.updateMe({ onboarding_completed: true });
      }
      onComplete?.();
    }
  };

  const handleSkip = () => {
    handleComplete();
  };

  if (!isVisible) return null;

  const isCenterPosition = step.position === 'center';

  return (
    <>
      {/* Overlay */}
      {step.target && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/30 z-40 pointer-events-none"
        />
      )}

      {/* Tour Popover */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className={`fixed z-50 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-sm ${
          isCenterPosition ? 'inset-0 m-auto h-fit' : ''
        }`}
        style={
          !isCenterPosition
            ? {
                top: `${position.top}px`,
                left: `${position.left}px`,
                transform: 'translate(-50%, -50%)',
              }
            : {}
        }
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {step.title}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Step {currentStep + 1} of {TOUR_STEPS.length}
              </p>
            </div>
            <button
              onClick={handleSkip}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          {/* Description */}
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">
            {step.description}
          </p>

          {/* Progress Bar */}
          <div className="w-full bg-slate-200 dark:bg-slate-700 h-1 rounded-full mb-6 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{
                width: `${((currentStep + 1) / TOUR_STEPS.length) * 100}%`,
              }}
              transition={{ duration: 0.3 }}
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-600"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handlePrev}
              disabled={currentStep === 0}
              size="sm"
              className="flex-1"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </Button>
            {currentStep === TOUR_STEPS.length - 1 ? (
              <Button onClick={handleComplete} size="sm" className="flex-1">
                Done
              </Button>
            ) : (
              <Button onClick={handleNext} size="sm" className="flex-1">
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>

          {/* Skip Button */}
          <button
            onClick={handleSkip}
            className="w-full mt-3 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            Skip tour
          </button>
        </div>
      </motion.div>
    </>
  );
}