import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { Ticket, Activity, DollarSign, Users, TrendingUp, Wifi, CreditCard } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { subDays, startOfDay } from 'date-fns';
import { toast } from 'sonner';

export default function HotspotDashboard() {
  const queryClient = useQueryClient();
  const { data: settings = [] } = useQuery({
    queryKey: ['settings'],
    queryFn: () => vibelink.entities.Setting.list(),
  });

  const hotspotPaymentGateway = settings.find(s => s.key === 'hotspot_payment_gateway')?.value || 'kopokopo';

  const updateGatewayMutation = useMutation({
    mutationFn: async (gateway) => {
      const existing = settings.find(s => s.key === 'hotspot_payment_gateway');
      if (existing) {
        return vibelink.entities.Setting.update(existing.id, { value: gateway });
      } else {
        return vibelink.entities.Setting.create({ key: 'hotspot_payment_gateway', value: gateway, category: 'payment_gateway', label: 'Hotspot Payment Gateway' });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['settings']);
      toast.success('Payment gateway updated');
    },
  });

  const { data: vouchers = [] } = useQuery({
    queryKey: ['vouchers'],
    queryFn: () => vibelink.entities.HotspotVoucher.list(),
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => vibelink.entities.HotspotSession.list('-created_date', 100),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['hotspot-payments'],
    queryFn: () => vibelink.entities.Payment.list('-created_date', 100),
  });

  const { data: hotspots = [] } = useQuery({
    queryKey: ['hotspots'],
    queryFn: () => vibelink.entities.Hotspot.list(),
  });

  // Calculate stats
  const activeVouchers = vouchers.filter(v => v.status === 'active').length;
  const onlineVouchers = sessions.filter(s => s.status === 'online').length;
  
  // Data used last 24 hours
  const last24Hours = subDays(new Date(), 1);
  const recentSessions = sessions.filter(s => 
    s.created_date && new Date(s.created_date) > last24Hours
  );
  const dataUsed24h = recentSessions.reduce((sum, s) => 
    sum + (s.data_uploaded || 0) + (s.data_downloaded || 0), 0
  ) / (1024 * 1024 * 1024); // Convert to GB

  // Payments today and this month
  const today = startOfDay(new Date());
  const paymentsToday = payments.filter(p => 
    p.created_date && startOfDay(new Date(p.created_date)).getTime() === today.getTime() &&
    p.status === 'completed'
  );
  const paymentsTodayAmount = paymentsToday.reduce((sum, p) => sum + (p.amount || 0), 0);

  const thisMonth = new Date();
  thisMonth.setDate(1);
  thisMonth.setHours(0, 0, 0, 0);
  const paymentsThisMonth = payments.filter(p => 
    p.created_date && new Date(p.created_date) >= thisMonth &&
    p.status === 'completed'
  );
  const paymentsMonthAmount = paymentsThisMonth.reduce((sum, p) => sum + (p.amount || 0), 0);

  const onlineUsers = sessions.filter(s => s.status === 'online').length;

  const stats = [
    {
      title: 'Active Vouchers',
      value: activeVouchers,
      subtitle: `${onlineVouchers} online`,
      icon: Ticket,
      color: 'bg-indigo-50 text-indigo-600',
    },
    {
      title: 'Data Used (24h)',
      value: `${dataUsed24h.toFixed(2)} GB`,
      subtitle: `${recentSessions.length} sessions`,
      icon: Activity,
      color: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: 'Revenue Today',
      value: `KES ${paymentsTodayAmount.toLocaleString()}`,
      subtitle: `${paymentsToday.length} payments`,
      icon: DollarSign,
      color: 'bg-purple-50 text-purple-600',
    },
    {
      title: 'Revenue This Month',
      value: `KES ${paymentsMonthAmount.toLocaleString()}`,
      subtitle: `${paymentsThisMonth.length} payments`,
      icon: TrendingUp,
      color: 'bg-amber-50 text-amber-600',
    },
    {
      title: 'Online Users',
      value: onlineUsers,
      subtitle: `${hotspots.filter(h => h.status === 'online').length} hotspots online`,
      icon: Users,
      color: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Total Hotspots',
      value: hotspots.length,
      subtitle: `${hotspots.filter(h => h.status === 'online').length} active`,
      icon: Wifi,
      color: 'bg-rose-50 text-rose-600',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Payment Gateway Selector */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="flex-1">
              <Label className="text-sm font-medium text-slate-900 dark:text-slate-50">Hotspot Payment Gateway</Label>
              <p className="text-xs text-slate-500 mt-0.5">Select how customers pay for vouchers</p>
            </div>
            <Select value={hotspotPaymentGateway} onValueChange={(v) => updateGatewayMutation.mutate(v)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kopokopo">Kopokopo</SelectItem>
                <SelectItem value="mpesa">M-Pesa (Paybill)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.map((stat, idx) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <Card className="hover:shadow-lg transition-shadow">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl ${stat.color} flex items-center justify-center`}>
                    <stat.icon className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-slate-500 mb-1">{stat.title}</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{stat.value}</p>
                    <p className="text-xs text-slate-400 mt-1">{stat.subtitle}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Online Users */}
      <Card>
        <CardHeader>
          <CardTitle>Online Users</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sessions.filter(s => s.status === 'online').slice(0, 10).map((session, idx) => (
              <motion.div
                key={session.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-50">{session.username || 'Guest'}</p>
                    <p className="text-xs text-slate-500 font-mono">{session.mac_address}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-50">{session.hotspot_name}</p>
                  <p className="text-xs text-slate-500">
                    {((session.data_uploaded + session.data_downloaded) / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              </motion.div>
            ))}
            {sessions.filter(s => s.status === 'online').length === 0 && (
              <p className="text-center text-slate-500 py-8">No users online</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}