import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import {
  HardDrive,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';

export default function BackupActionsDialog({
  open,
  onOpenChange,
  routerId,
  routerName,
}) {
  const [notes, setNotes] = useState('');
  const queryClient = useQueryClient();

  const backupMutation = useMutation({
    mutationFn: () =>
      vibelink.functions.invoke('createMikrotikBackup', {
        routerId,
        backupType: 'manual',
        notes,
      }),
    onSuccess: (data) => {
      toast.success('Backup created successfully');
      queryClient.invalidateQueries({ queryKey: ['backups', routerId] });
      setNotes('');
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error('Failed to create backup: ' + error.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="w-5 h-5" />
            Create Backup
          </DialogTitle>
          <DialogDescription>
            Create a manual backup of {routerName}'s configuration
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert className="border-blue-200 bg-blue-50">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800">
              Manual backups are stored separately from automatic daily backups and help preserve important configurations.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <label htmlFor="notes" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Notes (Optional)
            </label>
            <Textarea
              id="notes"
              placeholder="Add notes about this backup (e.g., 'Before firewall config change')"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-20"
              disabled={backupMutation.isPending}
            />
          </div>

          {backupMutation.isSuccess && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-start gap-3"
            >
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-emerald-900">Backup Created</p>
                <p className="text-sm text-emerald-700 mt-1">
                  Your configuration backup has been created and secured.
                </p>
              </div>
            </motion.div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={backupMutation.isPending}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={() => backupMutation.mutate()}
              disabled={backupMutation.isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-700"
            >
              {backupMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <HardDrive className="w-4 h-4 mr-2" />
                  Create Backup
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}