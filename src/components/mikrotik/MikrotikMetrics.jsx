import React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function MikrotikMetrics({ router, showAlerts = true }) {
  const metrics = [
    {
      label: 'CPU',
      value: router.cpu_usage || 0,
      unit: '%',
      threshold: 80,
      critical: 90,
    },
    {
      label: 'Memory',
      value: router.memory_usage || 0,
      unit: '%',
      threshold: 80,
      critical: 90,
    },
    {
      label: 'Sessions',
      value: router.active_sessions || 0,
      unit: 'active',
      threshold: null,
    },
    {
      label: 'Bandwidth',
      value: router.current_usage || 0,
      unit: `/ ${router.bandwidth_limit || 'N/A'} Mbps`,
      threshold: router.bandwidth_limit ? (router.bandwidth_limit * 0.8) : null,
    },
  ];

  const getStatusColor = (metric) => {
    const value = metric.value;
    if (metric.critical && value >= metric.critical) return 'text-rose-600';
    if (metric.threshold && value >= metric.threshold) return 'text-amber-600';
    return 'text-emerald-600';
  };

  const getAlertLevel = (metric) => {
    const value = metric.value;
    if (metric.critical && value >= metric.critical) return 'critical';
    if (metric.threshold && value >= metric.threshold) return 'warning';
    return null;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metrics.map((metric, idx) => {
          const alertLevel = getAlertLevel(metric);
          return (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className={cn(
                'p-3 rounded-lg border',
                alertLevel === 'critical'
                  ? 'bg-rose-50 border-rose-200'
                  : alertLevel === 'warning'
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-slate-50 border-slate-200'
              )}
            >
              <div className="flex items-start justify-between mb-2">
                <span className="text-xs font-semibold text-slate-600">
                  {metric.label}
                </span>
                {alertLevel && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                  >
                    {alertLevel === 'critical' ? (
                      <AlertTriangle className="w-3 h-3 text-rose-600" />
                    ) : (
                      <AlertCircle className="w-3 h-3 text-amber-600" />
                    )}
                  </motion.div>
                )}
              </div>
              <div className={cn('text-xl font-bold', getStatusColor(metric))}>
                {metric.value}
                <span className="text-xs ml-1">{metric.unit}</span>
              </div>
              {metric.threshold && (
                <div className="mt-2 w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min((metric.value / metric.threshold) * 100, 100)}%` }}
                    transition={{ duration: 0.5 }}
                    className={cn(
                      'h-full rounded-full',
                      metric.critical && metric.value >= metric.critical
                        ? 'bg-rose-500'
                        : metric.value >= metric.threshold
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    )}
                  />
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {showAlerts && metrics.some(m => getAlertLevel(m)) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-2"
        >
          {metrics
            .filter(m => getAlertLevel(m))
            .map(metric => (
              <div
                key={metric.label}
                className={cn(
                  'p-3 rounded-lg flex gap-2 items-start',
                  getAlertLevel(metric) === 'critical'
                    ? 'bg-rose-50 border border-rose-200'
                    : 'bg-amber-50 border border-amber-200'
                )}
              >
                {getAlertLevel(metric) === 'critical' ? (
                  <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                )}
                <div>
                  <p
                    className={cn(
                      'text-xs font-semibold',
                      getAlertLevel(metric) === 'critical'
                        ? 'text-rose-700'
                        : 'text-amber-700'
                    )}
                  >
                    {metric.label} {getAlertLevel(metric) === 'critical' ? 'Critical' : 'High'}
                  </p>
                  <p className="text-xs text-slate-600">
                    {metric.value}{metric.unit} {metric.threshold ? `(threshold: ${metric.threshold}${metric.unit.includes('%') ? '%' : ''})` : ''}
                  </p>
                </div>
              </div>
            ))}
        </motion.div>
      )}
    </div>
  );
}