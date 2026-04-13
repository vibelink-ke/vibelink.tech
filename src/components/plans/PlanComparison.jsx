import React from 'react';
import { motion } from 'framer-motion';
import { Check, X, Zap, Shield, Users, Headphones, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const tierInfo = {
  basic: {
    icon: Zap,
    gradient: 'from-slate-500 to-slate-600',
    bgGradient: 'from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800',
    badge: null
  },
  standard: {
    icon: Users,
    gradient: 'from-blue-500 to-indigo-600',
    bgGradient: 'from-blue-50 to-indigo-100',
    badge: 'Popular'
  },
  premium: {
    icon: Shield,
    gradient: 'from-purple-500 to-pink-600',
    bgGradient: 'from-purple-50 to-pink-100',
    badge: 'Best Value'
  },
  enterprise: {
    icon: Star,
    gradient: 'from-amber-500 to-orange-600',
    bgGradient: 'from-amber-50 to-orange-100',
    badge: 'Enterprise'
  }
};

export default function PlanComparison({ plans, onSelectPlan, currentPlanId }) {
  const sortedPlans = [...plans].sort((a, b) => {
    const tierOrder = { basic: 1, standard: 2, premium: 3, enterprise: 4 };
    return (tierOrder[a.tier] || 2) - (tierOrder[b.tier] || 2);
  });

  // Extract all unique features from all plans
  const allFeatures = Array.from(
    new Set(
      sortedPlans.flatMap(plan => 
        (plan.features || []).map(f => typeof f === 'string' ? f : f.name)
      )
    )
  );

  return (
    <div className="space-y-8">
      {/* Comparison Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {sortedPlans.map((plan, index) => {
          const info = tierInfo[plan.tier] || tierInfo.standard;
          const Icon = info.icon;
          const isCurrentPlan = plan.id === currentPlanId;

          return (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card className={`relative overflow-hidden hover:shadow-xl transition-all duration-300 ${
                isCurrentPlan ? 'ring-2 ring-indigo-500 shadow-lg' : ''
              }`}>
                {/* Gradient Header */}
                <div className={`h-2 bg-gradient-to-r ${info.gradient}`} />
                
                {/* Badge */}
                {info.badge && (
                  <div className="absolute top-6 right-4">
                    <Badge className={`bg-gradient-to-r ${info.gradient} text-white border-0`}>
                      {info.badge}
                    </Badge>
                  </div>
                )}

                {isCurrentPlan && (
                  <div className="absolute top-6 left-4">
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                      Current Plan
                    </Badge>
                  </div>
                )}

                <div className="p-6 space-y-6">
                  {/* Icon & Name */}
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${info.gradient} flex items-center justify-center`}>
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-slate-900 dark:text-slate-50">{plan.name}</h3>
                      <p className="text-sm text-slate-500 capitalize">{plan.tier} Tier</p>
                    </div>
                  </div>

                  {/* Price */}
                  <div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold text-slate-900 dark:text-slate-50">KES {plan.monthly_price}</span>
                      <span className="text-slate-500">/mo</span>
                    </div>
                    {plan.setup_fee > 0 && (
                      <p className="text-sm text-slate-500 mt-1">+ KES {plan.setup_fee} setup</p>
                    )}
                  </div>

                  {/* Speed */}
                  <div className={`p-4 rounded-xl bg-gradient-to-br ${info.bgGradient}`}>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Download</span>
                        <span className="text-lg font-bold text-slate-900 dark:text-slate-50">{plan.download_speed} Mbps</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Upload</span>
                        <span className="text-lg font-bold text-slate-900 dark:text-slate-50">{plan.upload_speed} Mbps</span>
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-slate-200/50">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Data</span>
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-50">
                          {plan.data_cap === 0 ? 'Unlimited' : `${plan.data_cap} GB`}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Key Features */}
                  <div className="space-y-2">
                    {(plan.features || []).slice(0, 5).map((feature, i) => {
                      const featureName = typeof feature === 'string' ? feature : feature.name;
                      const isIncluded = typeof feature === 'string' ? true : feature.included;
                      
                      return (
                        <div key={i} className="flex items-center gap-2">
                          {isIncluded ? (
                            <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                          ) : (
                            <X className="w-4 h-4 text-slate-300 flex-shrink-0" />
                          )}
                          <span className={`text-sm ${isIncluded ? 'text-slate-700' : 'text-slate-400'}`}>
                            {featureName}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Limits Info */}
                  {plan.limits && (
                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-1 text-xs text-slate-500">
                      {plan.limits.max_devices && (
                        <div>Up to {plan.limits.max_devices} devices</div>
                      )}
                      {plan.limits.support_level && (
                        <div className="flex items-center gap-1">
                          <Headphones className="w-3 h-3" />
                          {plan.limits.support_level} support
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action Button */}
                  <Button 
                    className={`w-full ${
                      isCurrentPlan 
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200' 
                        : `bg-gradient-to-r ${info.gradient} hover:opacity-90`
                    }`}
                    onClick={() => !isCurrentPlan && onSelectPlan?.(plan)}
                    disabled={isCurrentPlan}
                  >
                    {isCurrentPlan ? 'Current Plan' : 'Select Plan'}
                  </Button>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Detailed Feature Comparison Table */}
      {allFeatures.length > 0 && (
        <Card className="overflow-hidden">
          <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Feature Comparison</h3>
            <p className="text-sm text-slate-500 mt-1">Compare all features across plans</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800/50">
                <tr>
                  <th className="text-left p-4 font-semibold text-slate-700 dark:text-slate-300 min-w-[200px]">Feature</th>
                  {sortedPlans.map(plan => (
                    <th key={plan.id} className="text-center p-4 font-semibold text-slate-700 dark:text-slate-300 min-w-[120px]">
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allFeatures.map((featureName, idx) => (
                  <tr key={idx} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/50">
                    <td className="p-4 text-sm text-slate-700 dark:text-slate-300">{featureName}</td>
                    {sortedPlans.map(plan => {
                      const feature = (plan.features || []).find(f => 
                        (typeof f === 'string' ? f : f.name) === featureName
                      );
                      const isIncluded = feature ? (typeof feature === 'string' ? true : feature.included) : false;
                      const value = typeof feature === 'object' && feature.value ? feature.value : null;

                      return (
                        <td key={plan.id} className="p-4 text-center">
                          {isIncluded ? (
                            <div className="flex flex-col items-center gap-1">
                              <Check className="w-5 h-5 text-emerald-500" />
                              {value && <span className="text-xs text-slate-500">{value}</span>}
                            </div>
                          ) : (
                            <X className="w-5 h-5 text-slate-300 mx-auto" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}