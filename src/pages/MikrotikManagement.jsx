import React, { useState } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, AlertTriangle, Search, Zap, Layers, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { motion } from 'framer-motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/shared/PageHeader';
import MikrotikList from '@/components/mikrotik/MikrotikList.jsx';
import MikrotikDialog from '@/components/mikrotik/MikrotikDialog.jsx';
import DeviceDiscoveryDialog from '@/components/mikrotik/DeviceDiscoveryDialog.jsx';
import NetworkTopology from '@/components/mikrotik/NetworkTopology.jsx';
import TemplateEditor from '@/components/mikrotik/TemplateEditor.jsx';
import TemplateList from '@/components/mikrotik/TemplateList.jsx';
import MikrotikOnboardingScript from '@/components/mikrotik/MikrotikOnboardingScript.jsx';
import ApplyTemplateDialog from '@/components/mikrotik/ApplyTemplateDialog.jsx';
import WireguardManagement from '@/components/mikrotik/WireguardManagement.jsx';

export default function MikrotikManagement() {
  const [activeTab, setActiveTab] = useState('routers');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [discoveryDialogOpen, setDiscoveryDialogOpen] = useState(false);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [applyTemplateDialogOpen, setApplyTemplateDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [selectedRouter, setSelectedRouter] = useState(null);
  const queryClient = useQueryClient();

  const { data: routers = [], isLoading } = useQuery({
    queryKey: ['mikrotiks'],
    queryFn: () => vibelink.entities.Mikrotik.list(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['templates'],
    queryFn: () => vibelink.entities.MikrotikConfigTemplate.list(),
  });

  const syncMutation = useMutation({
    mutationFn: (routerId) =>
      vibelink.functions.invoke('syncMikrotikDevice', { routerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotiks'] });
    },
  });

  // Calculate critical alerts
  const criticalAlerts = routers.filter(router => {
    const cpuCritical = router.cpu_usage >= 90;
    const memoryCritical = router.memory_usage >= 90;
    const bandwidthCritical = router.bandwidth_limit && router.current_usage >= (router.bandwidth_limit * 0.9);
    const offline = router.status === 'offline';
    return cpuCritical || memoryCritical || bandwidthCritical || offline;
  });

  const handleAddNew = () => {
    setSelectedRouter(null);
    setDialogOpen(true);
  };

  const handleEdit = (router) => {
    setSelectedRouter(router);
    setDialogOpen(true);
  };

  const handleSync = (router) => {
    syncMutation.mutate(router.id);
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
    setSelectedRouter(null);
    queryClient.invalidateQueries({ queryKey: ['mikrotiks'] });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-6 transition-colors duration-500">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="MikroTik Management"
          subtitle="Manage routers, templates, and configurations"
          actionLabel={activeTab === 'routers' ? 'Add Router' : 'Create Template'}
          onAction={() => activeTab === 'routers' ? handleAddNew() : setTemplateEditorOpen(true)}
          actionIcon={activeTab === 'routers' ? Plus : Layers}
        />

        {/* Critical Alerts - Only show in routers tab */}
        {activeTab === 'routers' && criticalAlerts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Alert className="border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-900/20">
              <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              <AlertDescription className="text-rose-700 dark:text-rose-300">
                <strong className="dark:text-rose-200">{criticalAlerts.length}</strong> router(s) require immediate attention: {criticalAlerts.map(r => r.router_name).join(', ')}
              </AlertDescription>
            </Alert>
          </motion.div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 p-1">
            <TabsTrigger value="routers" className="flex items-center gap-2 dark:text-slate-400 dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-white">
              <Search className="w-4 h-4" />
              Routers
            </TabsTrigger>
            <TabsTrigger value="vpn" className="flex items-center gap-2 dark:text-slate-400 dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-white">
              <Shield className="w-4 h-4" />
              VPN & Connectivity
            </TabsTrigger>
            <TabsTrigger value="templates" className="flex items-center gap-2 dark:text-slate-400 dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-white">
              <Layers className="w-4 h-4" />
              Templates
            </TabsTrigger>
          </TabsList>

          <TabsContent value="routers" className="space-y-6">
            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="dark:bg-slate-900 dark:border-slate-800 shadow-sm transition-colors duration-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium dark:text-slate-200">Total Routers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold dark:text-white">{routers.length}</div>
                </CardContent>
              </Card>
              <Card className="dark:bg-slate-900 dark:border-slate-800 shadow-sm transition-colors duration-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium dark:text-slate-200">Online</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {routers.filter(r => r.status === 'online').length}
                  </div>
                </CardContent>
              </Card>
              <Card className="dark:bg-slate-900 dark:border-slate-800 shadow-sm transition-colors duration-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium dark:text-slate-200">Offline</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-600 dark:text-slate-400">
                    {routers.filter(r => r.status === 'offline').length}
                  </div>
                </CardContent>
              </Card>
              <Card className="dark:bg-slate-900 dark:border-slate-800 shadow-sm transition-colors duration-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium dark:text-slate-200">Alerts</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">{criticalAlerts.length}</div>
                </CardContent>
              </Card>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['mikrotiks'] })}
                disabled={isLoading}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
              <Button
                onClick={() => setDiscoveryDialogOpen(true)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Search className="w-4 h-4 mr-2" />
                Discover Devices
              </Button>
              <Button
                onClick={() => setOnboardingOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Zap className="w-4 h-4 mr-2" />
                Auto-Onboard
              </Button>
              <Button
                onClick={() => setApplyTemplateDialogOpen(true)}
                disabled={templates.length === 0}
                className="bg-amber-600 hover:bg-amber-700"
              >
                <Zap className="w-4 h-4 mr-2" />
                Apply Template
              </Button>
            </div>

            {/* Network Topology */}
            <NetworkTopology
              routers={routers}
              onSelectRouter={setSelectedRouter}
            />

            <MikrotikList
              routers={routers}
              isLoading={isLoading}
              onEdit={handleEdit}
              onSync={handleSync}
              isSyncing={syncMutation.isPending}
              onGetScript={(router) => {
                setSelectedRouter(router);
                setOnboardingOpen(true);
              }}
            />
          </TabsContent>

          <TabsContent value="vpn" className="space-y-6">
            <WireguardManagement />
          </TabsContent>

          <TabsContent value="templates" className="space-y-4">
            <TemplateList
              onEdit={(template) => {
                setSelectedTemplate(template);
                setTemplateEditorOpen(true);
              }}
              onApply={(template) => {
                setSelectedTemplate(template);
                setApplyTemplateDialogOpen(true);
              }}
            />
          </TabsContent>
        </Tabs>

        {/* Dialogs */}
        <MikrotikDialog
          open={dialogOpen}
          onOpenChange={handleDialogClose}
          router={selectedRouter}
        />

        <DeviceDiscoveryDialog
          open={discoveryDialogOpen}
          onOpenChange={setDiscoveryDialogOpen}
        />

        <TemplateEditor
          open={templateEditorOpen}
          onOpenChange={setTemplateEditorOpen}
          template={selectedTemplate}
          onSuccess={() => setSelectedTemplate(null)}
        />

        <ApplyTemplateDialog
          open={applyTemplateDialogOpen}
          onOpenChange={setApplyTemplateDialogOpen}
          templates={templates}
          routers={routers}
        />

        <MikrotikOnboardingScript
          open={onboardingOpen}
          onOpenChange={setOnboardingOpen}
          router={selectedRouter}
        />
      </div>
    </motion.div>
  );
}