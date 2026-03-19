import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const statusStyles = {
  // Customer statuses
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  suspended: 'bg-amber-50 text-amber-700 border-amber-200',
  pending: 'bg-blue-50 text-blue-700 border-blue-200',
  terminated: 'bg-slate-100 text-slate-600 border-slate-200',
  
  // Invoice statuses
  draft: 'bg-slate-100 text-slate-600 border-slate-200',
  sent: 'bg-blue-50 text-blue-700 border-blue-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  overdue: 'bg-rose-50 text-rose-700 border-rose-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
  
  // Ticket statuses
  open: 'bg-blue-50 text-blue-700 border-blue-200',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  waiting_customer: 'bg-purple-50 text-purple-700 border-purple-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed: 'bg-slate-100 text-slate-600 border-slate-200',
  
  // Payment statuses
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  refunded: 'bg-amber-50 text-amber-700 border-amber-200',
  
  // Priority
  low: 'bg-slate-100 text-slate-600 border-slate-200',
  medium: 'bg-blue-50 text-blue-700 border-blue-200',
  high: 'bg-amber-50 text-amber-700 border-amber-200',
  urgent: 'bg-rose-50 text-rose-700 border-rose-200',
  
  // General
  inactive: 'bg-slate-100 text-slate-500 border-slate-200',
  archived: 'bg-slate-100 text-slate-500 border-slate-200',
};

function StatusBadge({ status = 'pending', className = '', showPulse = false }) {
  const style = statusStyles[status] || statusStyles.pending;
  const label = status?.replace(/_/g, ' ');
  
  const shouldPulse = showPulse || ['active', 'online', 'open', 'in_progress'].includes(status);

  return (
    <Badge 
      variant="outline" 
      className={cn(
        "font-medium capitalize border relative",
        style,
        className
      )}
    >
      {shouldPulse && (
        <span className="absolute -left-1 top-1/2 -translate-y-1/2 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
        </span>
      )}
      <span className={shouldPulse ? 'ml-3' : ''}>{label}</span>
    </Badge>
  );
}

export default StatusBadge;
export { StatusBadge };