import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, Zap } from 'lucide-react';

export default function SubscriptionPlanCard({ plan, isSelected, onSelect, isAnnual }) {
  const price = isAnnual ? plan.annual_price : plan.monthly_price;
  const monthlyRate = isAnnual ? (plan.annual_price / 12) : plan.monthly_price;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -5 }}
    >
      <Card className={`relative h-full transition-all ${isSelected ? 'ring-2 ring-indigo-600' : ''}`}>
        {isSelected && (
          <div className="absolute top-0 right-0 bg-indigo-600 text-white px-4 py-1 rounded-bl-lg text-xs font-semibold">
            Current Plan
          </div>
        )}

        <CardHeader>
          <div className="flex items-start justify-between mb-4">
            <div>
              <CardTitle className="text-xl">{plan.name}</CardTitle>
              <p className="text-sm text-slate-500 mt-1">{plan.description}</p>
            </div>
            {plan.name.includes('Enterprise') && (
              <Zap className="w-5 h-5 text-yellow-500 flex-shrink-0" />
            )}
          </div>

          <div className="space-y-1">
            <div className="text-3xl font-bold text-slate-900">
              KES {monthlyRate.toLocaleString('en-KE')}
              <span className="text-lg font-normal text-slate-600">/month</span>
            </div>
            {isAnnual && price > 0 && (
              <p className="text-sm text-green-600">
                Save {Math.round((1 - (plan.annual_price / (plan.monthly_price * 12))) * 100)}% annually
              </p>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Features */}
          <div className="space-y-3">
            <h4 className="font-semibold text-slate-900 text-sm">Features included:</h4>
            <ul className="space-y-2">
              <li className="flex items-start gap-3">
                <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-slate-700">{plan.max_customers} customers</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-slate-700">{plan.max_staff} staff users</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-slate-700">{plan.support_tier} support</span>
              </li>
              {plan.api_access && (
                <li className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-slate-700">API access</span>
                </li>
              )}
              {plan.sso_enabled && (
                <li className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-slate-700">Single sign-on</span>
                </li>
              )}
              {plan.custom_branding && (
                <li className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-slate-700">Custom branding</span>
                </li>
              )}
              {plan.features?.map((feature, idx) => (
                <li key={idx} className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-slate-700">{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Action Button */}
          <Button
            onClick={() => onSelect(plan)}
            variant={isSelected ? 'default' : 'outline'}
            className={`w-full ${isSelected ? 'bg-indigo-600 hover:bg-indigo-700' : ''}`}
            disabled={isSelected}
          >
            {isSelected ? 'Current Plan' : 'Select Plan'}
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}