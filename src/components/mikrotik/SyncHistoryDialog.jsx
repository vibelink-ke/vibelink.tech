import React from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Loader2, RotateCcw, History } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function SyncHistoryDialog({ open, onOpenChange, routerId }) {
  const queryClient = useQueryClient();

  const { data: syncHistory = [], isLoading } = useQuery({
    queryKey: ['syncHistory', routerId],
    queryFn: () => vibelink.entities.SystemLog.filter({
      entity_type: 'Mikrotik',
      entity_id: routerId,
      action: 'synced',
    }),
    enabled: !!routerId && open,
  });

  const rollbackMutation = useMutation({
    mutationFn: (syncId) =>
      vibelink.functions.invoke('rollbackMikrotikSync', { syncId, routerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syncHistory', routerId] });
      queryClient.invalidateQueries({ queryKey: ['mikrotiks'] });
      toast.success('Sync rolled back successfully');
    },
    onError: (error) => {
      toast.error('Rollback failed: ' + error.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Sync History
          </DialogTitle>
          <DialogDescription>
            View and rollback previous configuration syncs
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : syncHistory.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            No sync history available
          </div>
        ) : (
          <div className="space-y-3">
            {syncHistory.map((log, idx) => (
              <div
                key={log.id}
                className="p-4 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium">Sync #{syncHistory.length - idx}</span>
                      <StatusBadge status={log.level} />
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                      {format(new Date(log.created_date), 'MMM dd, yyyy HH:mm:ss')}
                    </p>
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      {log.details}
                    </p>
                    {log.changes && (
                      <div className="mt-2 text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 p-2 rounded">
                        <details>
                          <summary className="cursor-pointer font-medium">View Details</summary>
                          <pre className="mt-2 whitespace-pre-wrap break-words">
                            {JSON.stringify(log.changes, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}
                  </div>
                  {idx === 0 ? (
                    <span className="text-xs text-slate-500 whitespace-nowrap">Current</span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => rollbackMutation.mutate(log.id)}
                      disabled={rollbackMutation.isPending}
                      className="text-slate-600 hover:text-slate-900"
                    >
                      {rollbackMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <RotateCcw className="w-4 h-4 mr-1" />
                          Rollback
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}