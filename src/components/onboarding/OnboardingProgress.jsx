import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';

export default function OnboardingProgress({ currentStep, totalSteps, steps }) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-8">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <React.Fragment key={step.id}>
              <motion.div
                className="flex flex-col items-center"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
              >
                <div className={`
                  w-12 h-12 rounded-full flex items-center justify-center font-semibold text-sm
                  transition-all
                  ${isCompleted
                    ? 'bg-green-100 text-green-700'
                    : isCurrent
                    ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                  }
                `}>
                  {isCompleted ? (
                    <CheckCircle2 className="w-6 h-6" />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </div>
                <p className={`
                  text-xs font-medium mt-2 text-center max-w-20
                  ${isCurrent || isCompleted ? 'text-slate-900 dark:text-slate-50' : 'text-slate-500'}
                `}>
                  {step.label}
                </p>
              </motion.div>

              {index < steps.length - 1 && (
                <motion.div
                  className={`
                    h-1 flex-1 mx-2 rounded-full
                    ${isCompleted ? 'bg-green-200' : 'bg-slate-200'}
                  `}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: index * 0.1 + 0.2 }}
                  style={{ originX: 0 }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1">
        <motion.div
          className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full"
          initial={{ width: '0%' }}
          animate={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </div>
  );
}