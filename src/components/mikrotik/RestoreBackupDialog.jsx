import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function RestoreBackupDialog({
  open,
  onOpenChange,
  backup,
  routerId,
  routerName,
}) {
  const [confirmed, setConfirmed] = useState(false);
  const queryClient = useQueryClient();

  const restoreMutation = useMutation({
    mutationFn: () =>
      vibelink.functions.invoke('restoreMikrotikBackup', {
        backupId: backup.id,
        routerId,
      }),
    onSuccess: () => {
      toast.success('Configuration restoration initiated');
      queryClient.invalidateQueries({ queryKey: ['backups', routerId] });
      onOpenChange(false);
      setConfirmed(false);
    },
    onError: (error) => {
      toast.error('Failed to restore backup: ' + error.message);
    },
  });

  if (!backup) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5" />
            Restore Configuration
          </DialogTitle>
          <DialogDescription>
            Restore {routerName} to a previous configuration
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Warning Alert */}
          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              This will replace the current router configuration with the backed-up version. Current settings will be overwritten.
            </AlertDescription>
          </Alert>

          {/* Backup Details */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-slate-50 rounded-lg p-4 space-y-2"
          >
            <div>
              <p className="text-xs text-slate-500">Backup Name</p>
              <p className="font-medium text-slate-900">{backup.backup_name}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Created</p>
              <p className="text-sm text-slate-700">
                {format(new Date(backup.created_date), 'MMM d, yyyy · h:mm a')}
              </p>
            </div>
            {backup.file_size && (
              <div>
                <p className="text-xs text-slate-500">Size</p>
                <p className="text-sm text-slate-700">
                  {(backup.file_size / 1024).toFixed(2)} KB
                </p>
              </div>
            )}
            {backup.backup_metadata && (
              <div>
                <p className="text-xs text-slate-500">Configuration Version</p>
                <p className="text-sm text-slate-700">
                  {backup.backup_metadata.config_version || 'Unknown'}
                </p>
              </div>
            )}
          </motion.div>

          {/* Confirmation Checkbox */}
          <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1 w-4 h-4"
            />
            <span className="text-sm text-slate-700">
              I understand this will overwrite the current configuration and cannot be undone
            </span>
          </label>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={restoreMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => restoreMutation.mutate()}
            disabled={!confirmed || restoreMutation.isPending}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {restoreMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Restoring...
              </>
            ) : (
              <>
                <RotateCcw className="w-4 h-4 mr-2" />
                Restore Configuration
              </>
            )}
          </Button>
        </DialogFooter>

        {restoreMutation.isSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-start gap-3"
          >
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-emerald-900">Configuration Restored</p>
              <p className="text-sm text-emerald-700">
                The router will now load the backed-up configuration
              </p>
            </div>
          </motion.div>
        )}
      </DialogContent>
    </Dialog>
  );
}