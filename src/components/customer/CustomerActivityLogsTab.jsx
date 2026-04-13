import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, User, CreditCard, FileText, Settings, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';

const categoryIcons = {
  billing: CreditCard,
  payment: CreditCard,
  invoice: FileText,
  customer: User,
  settings: Settings,
  ticket: MessageSquare,
  sms: MessageSquare,
  email: MessageSquare,
};

const levelColors = {
  info: 'bg-blue-100 text-blue-800',
  warning: 'bg-amber-100 text-amber-800',
  error: 'bg-rose-100 text-rose-800',
  debug: 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200',
};

export default function CustomerActivityLogsTab({ customerId, customer }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['customer-logs', customerId],
    queryFn: () => vibelink.entities.SystemLog.filter({ entity_id: customerId }, '-created_date', 50),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          Activity Logs
          <Badge variant="outline" className="ml-auto">{logs.length} events</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="text-center py-12">
            <Activity className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No activity logs found for this customer</p>
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => {
              const Icon = categoryIcons[log.category] || Activity;
              return (
                <div key={log.id} className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg hover:bg-slate-100 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-50 capitalize">{log.action}</span>
                      <Badge className={`text-xs ${levelColors[log.level] || levelColors.info}`}>{log.level}</Badge>
                      <Badge variant="outline" className="text-xs capitalize">{log.category}</Badge>
                    </div>
                    {log.details && <p className="text-xs text-slate-600 dark:text-slate-400 truncate">{log.details}</p>}
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      {log.user_name && <span>by {log.user_name}</span>}
                      {log.created_date && <span>{format(new Date(log.created_date), 'MMM d, yyyy HH:mm')}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}