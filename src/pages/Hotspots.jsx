import React, { useState } from 'react';
import PageHeader from '@/components/shared/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import HotspotDashboard from '@/components/hotspot/HotspotDashboard';
import HotspotPlans from '@/components/hotspot/HotspotPlans';
import HotspotVouchers from '@/components/hotspot/HotspotVouchers';
import HotspotDesign from '@/components/hotspot/HotspotDesign';
import HotspotRevenue from '@/components/hotspot/HotspotRevenue';
import { LayoutDashboard, FileText, Ticket, Palette, DollarSign } from 'lucide-react';

export default function Hotspots() {
  const [activeTab, setActiveTab] = useState('dashboard');

  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tab = urlParams.get('tab');
    if (tab) {
      setActiveTab(tab);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4 sm:p-8 transition-colors duration-500">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Hotspot Management"
          subtitle="Manage WiFi hotspots, vouchers, and revenue"
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white dark:bg-slate-800 border dark:border-slate-700 p-1">
            <TabsTrigger value="dashboard" className="gap-2">
              <LayoutDashboard className="w-4 h-4" /> Dashboard
            </TabsTrigger>
            <TabsTrigger value="plans" className="gap-2">
              <FileText className="w-4 h-4" /> Plans
            </TabsTrigger>
            <TabsTrigger value="vouchers" className="gap-2">
              <Ticket className="w-4 h-4" /> Vouchers
            </TabsTrigger>
            <TabsTrigger value="design" className="gap-2">
              <Palette className="w-4 h-4" /> Design
            </TabsTrigger>
            <TabsTrigger value="revenue" className="gap-2">
              <DollarSign className="w-4 h-4" /> Revenue
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard"><HotspotDashboard /></TabsContent>
          <TabsContent value="plans"><HotspotPlans /></TabsContent>
          <TabsContent value="vouchers"><HotspotVouchers /></TabsContent>
          <TabsContent value="design"><HotspotDesign /></TabsContent>
          <TabsContent value="revenue"><HotspotRevenue /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}