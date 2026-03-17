import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Edit2,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { toast } from 'sonner';
import AlertConfigDialog from './AlertConfigDialog';

export default function AlertsPanel({ routerId, routerName }) {
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState(null);
  const queryClient = useQueryClient();

  const { data: alerts = [], isLoading: alertsLoading } = useQuery({
    queryKey: ['alerts', routerId],
    queryFn: () =>
      vibelink.entities.MikrotikAlert.filter(
        { mikrotik_id: routerId },
        '-created_date'
      ),
    enabled: !!routerId,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: configs = [], isLoading: configsLoading } = useQuery({
    queryKey: ['alert-configs', routerId],
    queryFn: () =>
      vibelink.entities.MikrotikAlertConfig.filter(
        { mikrotik_id: routerId },
        '-created_date'
      ),
    enabled: !!routerId,
  });

  const acknowledgeAlertMutation = useMutation({
    mutationFn: (alertId) =>
      vibelink.entities.MikrotikAlert.update(alertId, {
        status: 'acknowledged',
        acknowledged_by: 'current_user',
        acknowledged_at: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts', routerId] });
      toast.success('Alert acknowledged');
    },
  });

  const deleteConfigMutation = useMutation({
    mutationFn: (configId) =>
      vibelink.entities.MikrotikAlertConfig.delete(configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-configs', routerId] });
      toast.success('Alert configuration deleted');
    },
    onError: () => {
      toast.error('Failed to delete alert configuration');
    },
  });

  const activeAlerts = alerts.filter(a => a.status === 'active');
  const acknowledgedAlerts = alerts.filter(a => a.status === 'acknowledged');

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return 'bg-rose-50 border-rose-200 text-rose-900';
      case 'warning':
        return 'bg-amber-50 border-amber-200 text-amber-900';
      default:
        return 'bg-blue-50 border-blue-200 text-blue-900';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="w-5 h-5 text-rose-600" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-600" />;
      default:
        return <Bell className="w-5 h-5 text-blue-600" />;
    }
  };

  const getAlertIcon = (type) => {
    const icons = {
      cpu_usage: '⚙️',
      memory_usage: '💾',
      disk_space: '🖥️',
      interface_down: '🌐',
      bandwidth_limit: '📊',
      config_change: '🔧',
    };
    return icons[type] || '⚠️';
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Alert Management
            </CardTitle>
            <Button
              size="sm"
              onClick={() => {
                setSelectedConfig(null);
                setConfigDialogOpen(true);
              }}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Alert
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="active" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="active" className="relative">
                Active
                {activeAlerts.length > 0 && (
                  <Badge className="ml-2 bg-rose-600">
                    {activeAlerts.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="acknowledged">
                Acknowledged
                {acknowledgedAlerts.length > 0 && (
                  <Badge className="ml-2 bg-amber-600">
                    {acknowledgedAlerts.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="configs">
                Configurations
              </TabsTrigger>
            </TabsList>

            {/* Active Alerts */}
            <TabsContent value="active" className="space-y-3">
              {activeAlerts.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  No active alerts
                </div>
              ) : (
                <AnimatePresence>
                  {activeAlerts.map((alert, idx) => (
                    <motion.div
                      key={alert.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ delay: idx * 0.05 }}
                      className={`p-4 rounded-lg border ${getSeverityColor(alert.severity)}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex gap-3 flex-1">
                          {getSeverityIcon(alert.severity)}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{getAlertIcon(alert.alert_type)}</span>
                              <p className="font-semibold">{alert.message}</p>
                            </div>
                            <p className="text-sm opacity-75 mt-1">
                              {format(new Date(alert.created_date), 'MMM d, yyyy · h:mm a')}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => acknowledgeAlertMutation.mutate(alert.id)}
                          disabled={acknowledgeAlertMutation.isPending}
                          className="whitespace-nowrap"
                        >
                          Acknowledge
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </TabsContent>

            {/* Acknowledged Alerts */}
            <TabsContent value="acknowledged" className="space-y-3">
              {acknowledgedAlerts.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  No acknowledged alerts
                </div>
              ) : (
                <AnimatePresence>
                  {acknowledgedAlerts.map((alert) => (
                    <motion.div
                      key={alert.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="p-4 rounded-lg border border-slate-200 bg-slate-50"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex gap-3">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                          <div>
                            <p className="font-medium">{alert.message}</p>
                            <p className="text-xs text-slate-500 mt-1">
                              Acknowledged at{' '}
                              {format(new Date(alert.acknowledged_at), 'MMM d · h:mm a')}
                            </p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </TabsContent>

            {/* Configurations */}
            <TabsContent value="configs" className="space-y-3">
              {configsLoading ? (
                <div className="text-center py-8 text-slate-500">Loading...</div>
              ) : configs.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  No alert configurations yet
                </div>
              ) : (
                <AnimatePresence>
                  {configs.map((config) => (
                    <motion.div
                      key={config.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="p-4 rounded-lg border border-slate-200 bg-white"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{getAlertIcon(config.alert_type)}</span>
                            <p className="font-medium text-slate-900">
                              {config.alert_type.replace(/_/g, ' ').toUpperCase()}
                            </p>
                            {config.enabled ? (
                              <Badge className="bg-emerald-100 text-emerald-800">
                                Enabled
                              </Badge>
                            ) : (
                              <Badge variant="outline">Disabled</Badge>
                            )}
                          </div>
                          <div className="mt-2 text-sm text-slate-600 space-y-1">
                            <p>
                              Threshold: {config.threshold_value}{config.threshold_unit === 'percent' ? '%' : ''}
                            </p>
                            <p>
                              Channels:{' '}
                              {config.notification_channels
                                .map(c => c.charAt(0).toUpperCase() + c.slice(1))
                                .join(', ')}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedConfig(config);
                              setConfigDialogOpen(true);
                            }}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteConfigMutation.mutate(config.id)}
                            disabled={deleteConfigMutation.isPending}
                            className="text-rose-600 hover:text-rose-700"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <AlertConfigDialog
        open={configDialogOpen}
        onOpenChange={setConfigDialogOpen}
        routerId={routerId}
        routerName={routerName}
        config={selectedConfig}
      />
    </>
  );
}