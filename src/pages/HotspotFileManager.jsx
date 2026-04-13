import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { Upload, RefreshCw, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import HotspotFileUpload from '@/components/onboarding/HotspotFileUpload';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export default function HotspotFileManager() {
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const queryClient = useQueryClient();

  const { data: hotspotFiles = [], isLoading: loadingFiles } = useQuery({
    queryKey: ['hotspotFiles'],
    queryFn: () => vibelink.entities.HotspotFile.list('-created_date'),
  });

  const { data: hotspots = [] } = useQuery({
    queryKey: ['hotspots'],
    queryFn: () => vibelink.entities.Hotspot.list(),
  });

  const { data: mikrotiks = [] } = useQuery({
    queryKey: ['mikrotiks'],
    queryFn: () => vibelink.entities.Mikrotik.list(),
  });

  const deleteFileMutation = useMutation({
    mutationFn: (id) => vibelink.entities.HotspotFile.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['hotspotFiles']);
      toast.success('File deleted successfully');
    },
  });

  const retryUploadMutation = useMutation({
    mutationFn: async (hotspotFileId) => {
      return vibelink.functions.invoke('uploadHotspotToMikrotik', {
        hotspotFileId,
        mikrotikId: hotspotFiles.find(f => f.id === hotspotFileId)?.mikrotik_id
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['hotspotFiles']);
      toast.success('Upload completed');
    },
    onError: () => {
      toast.error('Upload failed');
    },
  });

  const stats = {
    total: hotspotFiles.length,
    uploaded: hotspotFiles.filter(f => f.upload_status === 'uploaded').length,
    pending: hotspotFiles.filter(f => f.upload_status === 'pending').length,
    failed: hotspotFiles.filter(f => f.upload_status === 'failed').length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Hotspot File Manager"
          subtitle="Generate and upload hotspot configurations to MikroTik"
          actionLabel="New Configuration"
          onAction={() => setShowUploadDialog(true)}
        />

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-6">
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{stats.total}</p>
              <p className="text-sm text-slate-500">Total Files</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <p className="text-2xl font-bold text-emerald-600">{stats.uploaded}</p>
              <p className="text-sm text-slate-500">Uploaded</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
              <p className="text-sm text-slate-500">Pending</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <p className="text-2xl font-bold text-rose-600">{stats.failed}</p>
              <p className="text-sm text-slate-500">Failed</p>
            </CardContent>
          </Card>
        </div>

        {/* Files List */}
        {loadingFiles ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-white dark:bg-slate-900 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : hotspotFiles.length === 0 ? (
          <EmptyState
            icon={Upload}
            title="No hotspot files yet"
            description="Create your first hotspot configuration file"
            actionLabel="New Configuration"
            onAction={() => setShowUploadDialog(true)}
          />
        ) : (
          <div className="space-y-4">
            {hotspotFiles.map((file, index) => (
              <motion.div
                key={file.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-slate-900 dark:text-slate-50">{file.file_name}</h3>
                          <Badge variant="outline" className="text-xs">
                            {file.file_type.toUpperCase()}
                          </Badge>
                          <StatusBadge status={file.upload_status} />
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                          Hotspot: {file.hotspot_name}
                        </p>
                        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                          <span>Created: {format(new Date(file.created_date), 'MMM d, HH:mm')}</span>
                          {file.uploaded_date && (
                            <span>Uploaded: {format(new Date(file.uploaded_date), 'MMM d, HH:mm')}</span>
                          )}
                          {file.upload_error && (
                            <span className="text-rose-600">Error: {file.upload_error}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {file.upload_status === 'failed' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => retryUploadMutation.mutate(file.id)}
                            disabled={retryUploadMutation.isPending}
                          >
                            <RefreshCw className="w-4 h-4 mr-1" />
                            Retry
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteFileMutation.mutate(file.id)}
                          disabled={deleteFileMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4 text-rose-600" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        {/* Upload Dialog */}
        <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Hotspot Configuration</DialogTitle>
            </DialogHeader>
            <HotspotFileUpload
              hotspots={hotspots}
              mikrotiks={mikrotiks}
              onComplete={() => {
                setShowUploadDialog(false);
                queryClient.invalidateQueries(['hotspotFiles']);
                toast.success('Hotspot configuration created');
              }}
            />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}