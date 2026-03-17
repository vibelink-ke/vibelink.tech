import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DataTable } from '@/components/shared/DataTable';
import EmptyState from '@/components/shared/EmptyState';
import MikrotikMetrics from './MikrotikMetrics';
import SyncScheduleDialog from './SyncScheduleDialog';
import SyncHistoryDialog from './SyncHistoryDialog';
import { RefreshCw, Edit2, Wifi, Clock, History, HardDrive, FileCode } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import BackupActionsDialog from './BackupActionsDialog';
import BackupHistory from './BackupHistory';
import AlertsPanel from './AlertsPanel';

export default function MikrotikList({ routers, isLoading, onEdit, onSync, isSyncing, onGetScript }) {
  const [expandedRouter, setExpandedRouter] = useState(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);
  const [selectedRouter, setSelectedRouter] = useState(null);

  const columns = [
    {
      header: 'Router Name',
      accessor: 'router_name',
      cell: (row) => (
        <div className="font-medium text-slate-900 dark:text-white">{row.router_name}</div>
      ),
    },
    {
      header: 'IP Address',
      accessor: 'ip_address',
      cell: (row) => (
        <code className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
          {row.ip_address}
        </code>
      ),
    },
    {
      header: 'Status',
      accessor: 'status',
      cell: (row) => <StatusBadge status={row.status} className="" />,
    },
    {
      header: 'Customers',
      accessor: 'total_customers',
      cell: (row) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {row.total_customers || 0}
        </span>
      ),
    },
    {
      header: 'CPU / Memory',
      accessor: 'cpu_usage',
      cell: (row) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {row.cpu_usage || 0}% / {row.memory_usage || 0}%
        </span>
      ),
    },
    {
      header: 'Last Seen',
      accessor: 'last_connected',
      cell: (row) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {row.last_connected
            ? format(new Date(row.last_connected), 'MMM dd, HH:mm')
            : 'Never'}
        </span>
      ),
    },
    {
      header: 'Actions',
      accessor: 'id',
      cell: (row) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(row)}
            title="Edit router"
            className="text-slate-600 hover:text-slate-900"
          >
            <Edit2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSync(row)}
            disabled={isSyncing || row.status === 'offline'}
            title="Sync now"
            className="text-slate-600 hover:text-slate-900"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedRouter(row);
              setScheduleDialogOpen(true);
            }}
            title="Schedule syncs"
            className="text-slate-600 hover:text-slate-900"
          >
            <Clock className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedRouter(row);
              setHistoryDialogOpen(true);
            }}
            title="View sync history"
            className="text-slate-600 hover:text-slate-900"
          >
            <History className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedRouter(row);
              setBackupDialogOpen(true);
            }}
            title="Backup configuration"
            className="text-slate-600 hover:text-slate-900"
          >
            <HardDrive className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onGetScript(row)}
            title="Get Onboarding Script"
            className="text-slate-600 hover:text-slate-900"
          >
            <FileCode className="w-4 h-4" />
          </Button>
          </div>
          ),
          },
          ];

  if (isLoading) {
    return <DataTable columns={columns} data={[]} isLoading={true} />;
  }

  if (!routers || routers.length === 0) {
    return (
      <EmptyState
        icon={Wifi}
        title="No MikroTik Routers"
        description="Start by adding your first network router to manage customers and services."
      />
    );
  }

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="w-5 h-5" />
              Connected Routers ({routers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable 
              columns={columns} 
              data={routers}
              onRowClick={(row) => setExpandedRouter(expandedRouter === row.id ? null : row.id)}
            />
          </CardContent>
        </Card>

        {/* Expanded Router Metrics */}
        {routers.map(router => 
          expandedRouter === router.id ? (
            <motion.div
              key={router.id}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <Card className="border-indigo-200 dark:border-indigo-800">
                <CardHeader>
                  <CardTitle className="text-lg">
                    {router.router_name} - Real-time Metrics
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <MikrotikMetrics router={router} />
                </CardContent>
              </Card>
              <AlertsPanel routerId={router.id} routerName={router.router_name} />
              <BackupHistory routerId={router.id} routerName={router.router_name} />
            </motion.div>
          ) : null
        )}
      </motion.div>

      {/* Dialogs */}
      <SyncScheduleDialog
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
        routers={selectedRouter ? [selectedRouter] : routers}
      />
      
      <SyncHistoryDialog
        open={historyDialogOpen}
        onOpenChange={setHistoryDialogOpen}
        routerId={selectedRouter?.id}
      />

      <BackupActionsDialog
        open={backupDialogOpen}
        onOpenChange={setBackupDialogOpen}
        routerId={selectedRouter?.id}
        routerName={selectedRouter?.router_name}
      />
    </>
  );
}