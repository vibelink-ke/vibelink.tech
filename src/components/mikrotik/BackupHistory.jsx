import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { Download, Trash2, RotateCcw, Clock, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { toast } from 'sonner';
import RestoreBackupDialog from './RestoreBackupDialog';

export default function BackupHistory({ routerId, routerName }) {
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState(null);
  const queryClient = useQueryClient();

  const { data: backups = [], isLoading } = useQuery({
    queryKey: ['backups', routerId],
    queryFn: () =>
      vibelink.entities.MikrotikBackup.filter(
        { mikrotik_id: routerId },
        '-created_date'
      ),
    enabled: !!routerId,
  });

  const deleteMutation = useMutation({
    mutationFn: (backupId) =>
      vibelink.entities.MikrotikBackup.delete(backupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups', routerId] });
      toast.success('Backup deleted successfully');
    },
    onError: (error) => {
      toast.error('Failed to delete backup');
    },
  });

  const handleDownload = (backup) => {
    if (backup.file_url) {
      window.open(backup.file_url, '_blank');
      toast.success(`Downloaded ${backup.backup_name}`);
    } else {
      toast.error('Backup file not available');
    }
  };

  const handleRestore = (backup) => {
    setSelectedBackup(backup);
    setRestoreDialogOpen(true);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-emerald-600" />;
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-rose-600" />;
      case 'in_progress':
        return <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'success':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'failed':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'in_progress':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-slate-500" />
              <CardTitle>Backup History</CardTitle>
            </div>
            {backups.length > 0 && (
              <Badge variant="secondary">{backups.length} backups</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {backups.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-500 text-sm">No backups yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {backups.map((backup, index) => (
                <motion.div
                  key={backup.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`p-4 rounded-lg border ${getStatusColor(backup.status)}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="mt-1">{getStatusIcon(backup.status)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900">
                          {backup.backup_name}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <Badge variant="outline" className="text-xs">
                            {backup.backup_type === 'automatic' ? '🕐 Auto' : '📋 Manual'}
                          </Badge>
                          {backup.file_size && (
                            <Badge variant="outline" className="text-xs">
                              {(backup.file_size / 1024).toFixed(2)} KB
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-2">
                          {format(new Date(backup.created_date), 'MMM d, yyyy · h:mm a')}
                        </p>
                        {backup.notes && (
                          <p className="text-sm mt-2 text-slate-700">{backup.notes}</p>
                        )}
                      </div>
                    </div>

                    {backup.status === 'success' && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownload(backup)}
                          className="flex items-center gap-2"
                        >
                          <Download className="w-4 h-4" />
                          Download
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRestore(backup)}
                          className="flex items-center gap-2"
                        >
                          <RotateCcw className="w-4 h-4" />
                          Restore
                        </Button>
                      </div>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(backup.id)}
                      disabled={deleteMutation.isPending}
                      className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {backup.status === 'failed' && backup.error_message && (
                    <p className="text-sm mt-2 text-rose-600">{backup.error_message}</p>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <RestoreBackupDialog
        open={restoreDialogOpen}
        onOpenChange={setRestoreDialogOpen}
        backup={selectedBackup}
        routerId={routerId}
        routerName={routerName}
      />
    </>
  );
}