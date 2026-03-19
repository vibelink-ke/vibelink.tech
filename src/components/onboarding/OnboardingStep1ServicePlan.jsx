import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, Download, Upload, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

export default function OnboardingStep1ServicePlan({ servicePlans = [], formData, setFormData }) {
  const selectedPlan = servicePlans.find(p => p.id === formData.plan_id);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {servicePlans.map((plan) => (
          <motion.div
            key={plan.id}
            whileHover={{ y: -4 }}
            onClick={() =>
              setFormData({
                ...formData,
                plan_id: plan.id,
                plan_name: plan.name,
                monthly_rate: plan.monthly_price,
              })
            }
          >
            <Card
              className={`cursor-pointer transition-all dark:bg-slate-900 dark:border-slate-800 ${
                formData.plan_id === plan.id
                  ? 'ring-2 ring-indigo-600 border-indigo-600 dark:ring-indigo-500 dark:border-indigo-500'
                  : 'hover:border-slate-400 dark:hover:border-slate-600'
              }`}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 dark:text-white">
                      {plan.name}
                      {formData.plan_id === plan.id && (
                        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      )}
                    </CardTitle>
                    <CardDescription className="dark:text-slate-400">{plan.description}</CardDescription>
                  </div>
                  <Badge
                    variant={
                      plan.tier === 'premium'
                        ? 'default'
                        : plan.tier === 'standard'
                        ? 'secondary'
                        : 'outline'
                    }
                    className="dark:bg-slate-800 dark:text-slate-200"
                  >
                    {plan.tier}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="pt-4 border-t dark:border-slate-800 space-y-3">
                  <div className="flex items-center gap-3">
                    <Download className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-200">Download</p>
                      <p className="text-lg font-bold text-slate-900 dark:text-white">{plan.download_speed} Mbps</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Upload className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-200">Upload</p>
                      <p className="text-lg font-bold text-slate-900 dark:text-white">{plan.upload_speed} Mbps</p>
                    </div>
                  </div>
                  {plan.data_cap > 0 && (
                    <div className="flex items-center gap-3">
                      <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-200">Data Cap</p>
                        <p className="text-lg font-bold text-slate-900 dark:text-white">{plan.data_cap} GB</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3">
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Monthly Price</p>
                  <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">KES {plan.monthly_price.toLocaleString()}</p>
                  {plan.setup_fee > 0 && (
                    <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">Setup fee: KES {plan.setup_fee.toLocaleString()}</p>
                  )}
                </div>

                {plan.features && plan.features.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-200">Features:</p>
                    <ul className="space-y-1">
                      {plan.features.slice(0, 3).map((feature, idx) => (
                        <li key={idx} className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                          {feature.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {!formData.plan_id && (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-400">
          <strong>Next Step:</strong> Select a service plan to continue with customer setup
        </div>
      )}

      {selectedPlan && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg text-sm text-emerald-800 dark:text-emerald-400"
        >
          <strong>✓ Selected:</strong> {selectedPlan.name} - KES {selectedPlan.monthly_price.toLocaleString()}/month
        </motion.div>
      )}
    </div>
  );
}