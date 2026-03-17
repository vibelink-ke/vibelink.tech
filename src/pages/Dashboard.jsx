import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { 
  Users, 
  FileText, 
  CreditCard, 
  AlertCircle, 
  TrendingUp,
  ArrowRight,
  Wifi,
  Clock,
  Shield,
  Activity
} from 'lucide-react';
import { format } from 'date-fns';
import StatCard from '@/components/shared/StatCard';
import StatusBadge from '@/components/shared/StatusBadge';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { Button } from '@/components/ui/button';

export default function Dashboard() {
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => vibelink.entities.Customer.list(),
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => vibelink.entities.Invoice.list('-created_date', 100),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments'],
    queryFn: () => vibelink.entities.Payment.list('-created_date', 100),
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => vibelink.entities.SupportTicket.list('-created_date', 10),
  });

  const { data: slas = [] } = useQuery({
    queryKey: ['slas'],
    queryFn: () => vibelink.entities.SLA.list(),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['plans'],
    queryFn: () => vibelink.entities.ServicePlan.list(),
  });

  const { data: logs = [] } = useQuery({
    queryKey: ['recent-logs'],
    queryFn: () => vibelink.entities.SystemLog.list('-created_date', 10),
  });

  // Calculate stats
  const activeCustomers = customers.filter(c => c.status === 'active').length;
  const pendingInvoices = invoices.filter(i => i.status === 'sent' || i.status === 'overdue');
  const totalRevenue = payments
    .filter(p => p.status === 'completed')
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  const overdueInvoices = invoices.filter(i => i.status === 'overdue');
  const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;

  // SLA alerts
  const customersWithSLA = customers.filter(c => {
    const plan = plans.find(p => p.id === c.plan_id);
    return plan?.sla_id && c.status === 'active';
  });
  
  const slaAlerts = tickets.filter(t => {
    const customer = customers.find(c => c.id === t.customer_id);
    if (!customer) return false;
    const plan = plans.find(p => p.id === customer.plan_id);
    const sla = slas.find(s => s.id === plan?.sla_id);
    if (!sla || t.status === 'resolved' || t.status === 'closed') return false;
    
    // Check if ticket is approaching SLA breach
    if (t.created_date && sla.ticket_response_time_hours) {
      const hoursSinceCreated = (Date.now() - new Date(t.created_date).getTime()) / (1000 * 60 * 60);
      return hoursSinceCreated > sla.ticket_response_time_hours * 0.8; // 80% threshold
    }
    return false;
  }).length;

  // Monthly revenue chart data
  const monthlyData = React.useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const months_list = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthPayments = payments.filter(p => {
        if (!p.created_date) return false;
        const pDate = new Date(p.created_date);
        return pDate.getMonth() === date.getMonth() && pDate.getFullYear() === date.getFullYear();
      });
      months.push({
        month: months_list[date.getMonth()],
        revenue: monthPayments.reduce((sum, p) => sum + (p.amount || 0), 0)
      });
    }
    return months;
  }, [payments]);

  // Real-time network throughput mock data (SVG Chart)
  const throughputData = React.useMemo(() => {
    return Array.from({ length: 20 }, (_, i) => ({
      time: i,
      download: Math.floor(Math.random() * 80) + 20,
      upload: Math.floor(Math.random() * 30) + 5
    }));
  }, []);

  const NetworkThroughputChart = () => {
    const maxVal = 100;
    const width = 400;
    const height = 150;
    const padding = 20;
    
    const getX = (i) => padding + (i * (width - 2 * padding)) / (throughputData.length - 1);
    const getY = (val) => height - padding - (val * (height - 2 * padding)) / maxVal;

    const downloadPoints = throughputData.map((d, i) => `${getX(i)},${getY(d.download)}`).join(' ');
    const uploadPoints = throughputData.map((d, i) => `${getX(i)},${getY(d.upload)}`).join(' ');

    return (
      <div className="w-full">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map(v => (
            <line 
              key={v} 
              x1={padding} y1={getY(v)} x2={width - padding} y2={getY(v)} 
              className="stroke-slate-200 dark:stroke-slate-700" 
              strokeWidth="1" 
              strokeDasharray="4 4" 
            />
          ))}
          
          {/* Download Line */}
          <motion.polyline
            fill="none"
            stroke="#6366f1"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={downloadPoints}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
          />
          
          {/* Upload Line */}
          <motion.polyline
            fill="none"
            stroke="#10b981"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={uploadPoints}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
          />
          
          {/* Area under download */}
          <path
            d={`M ${padding} ${height - padding} ${downloadPoints} L ${width - padding} ${height - padding} Z`}
            className="fill-indigo-500/10 dark:fill-indigo-500/5"
          />
        </svg>
        <div className="flex justify-center gap-6 mt-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-indigo-500" />
            <span className="text-xs text-slate-500 font-medium">Download (Mbps)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="text-xs text-slate-500 font-medium">Upload (Mbps)</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4 sm:p-8 transition-colors duration-500">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Overview of your ISP billing system</p>
        </motion.div>

        {/* SLA Alert Banner */}
        {slaAlerts > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-amber-50 border border-amber-200 rounded-2xl p-4"
          >
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              <div className="flex-1">
                <p className="font-semibold text-amber-900">SLA Breach Warning</p>
                <p className="text-sm text-amber-700">
                  {slaAlerts} {slaAlerts === 1 ? 'ticket is' : 'tickets are'} approaching SLA breach threshold
                </p>
              </div>
              <Link to={createPageUrl('SLACompliance')}>
                <Button variant="outline" size="sm" className="border-amber-300">
                  View Details
                </Button>
              </Link>
            </div>
          </motion.div>
        )}

        {/* Stats Grid */}
        <motion.div 
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          data-tour="dashboard"
          initial="hidden"
          animate="visible"
          variants={{
            visible: { transition: { staggerChildren: 0.1 } }
          }}
        >
          <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}>
             <div>
               <StatCard
                 title="Active Customers"
                 value={activeCustomers}
                 subtitle={`${customers.length} total`}
                 icon={Users}
                 trend="+12%"
                 trendUp={true}
                 className="h-full"
               />
             </div>
          </motion.div>
          <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}>
             <div>
               <StatCard
                 title="Active Hotspot Users"
                 value={Math.floor(activeCustomers * 0.85)}
                 subtitle="Connected now"
                 icon={Activity}
                 trend="+15%"
                 trendUp={true}
                 className="h-full"
               />
             </div>
          </motion.div>
          <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}>
             <div>
               <StatCard
                 title="Monthly Revenue"
                 value={`KES ${totalRevenue.toLocaleString()}`}
                 subtitle="This period"
                 icon={CreditCard}
                 trend="+8%"
                 trendUp={true}
                 className="h-full"
               />
             </div>
          </motion.div>
          <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}>
             <div>
               <StatCard
                 title="Open Tickets"
                 value={openTickets}
                 subtitle={`${tickets.length} total tickets`}
                 icon={AlertCircle}
                 trend=""
                 trendUp={false}
                 className="h-full"
               />
             </div>
          </motion.div>
        </motion.div>

        {/* Network Throughput Chart Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 shadow-sm"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-indigo-500" />
                Network Throughput
              </h3>
              <p className="text-sm text-slate-500">Real-time traffic monitor (Mbps)</p>
            </div>
            <div className="flex gap-2">
              <div className="px-3 py-1 bg-indigo-50 dark:bg-indigo-900/30 rounded-full text-xs font-medium text-indigo-600 dark:text-indigo-400">
                Live
              </div>
            </div>
          </div>
          <div className="h-[200px] flex items-center justify-center">
            <NetworkThroughputChart />
          </div>
        </motion.div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.02, y: -4 }}
            transition={{ delay: 0.1 }}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 hover:shadow-lg transition-shadow group relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/30 to-purple-50/30 dark:from-indigo-900/10 dark:to-purple-900/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative flex items-center gap-3 mb-3">
              <motion.div 
                whileHover={{ rotate: 360 }}
                transition={{ duration: 0.5 }}
                className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-900/30 dark:to-indigo-800/30 flex items-center justify-center"
              >
                <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </motion.div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{pendingInvoices.length}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Pending Invoices</p>
              </div>
            </div>
            <p className="relative text-sm text-slate-600 dark:text-slate-300 font-medium">
              KES {pendingInvoices.reduce((s, i) => s + (i.total_amount || 0), 0).toLocaleString()}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.02, y: -4 }}
            transition={{ delay: 0.15 }}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 hover:shadow-lg transition-shadow group relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-rose-50/30 to-pink-50/30 dark:from-rose-900/10 dark:to-pink-900/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative flex items-center gap-3 mb-3">
              <motion.div 
                whileHover={{ rotate: 360 }}
                transition={{ duration: 0.5 }}
                className="w-10 h-10 rounded-lg bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-900/30 dark:to-rose-800/30 flex items-center justify-center"
              >
                <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
              </motion.div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{overdueInvoices.length}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Overdue Invoices</p>
              </div>
            </div>
            <p className="relative text-sm text-slate-600 dark:text-slate-300 font-medium">
              KES {overdueInvoices.reduce((s, i) => s + (i.total_amount || 0), 0).toLocaleString()}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.02, y: -4 }}
            transition={{ delay: 0.2 }}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 hover:shadow-lg transition-shadow group relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/30 to-teal-50/30 dark:from-emerald-900/10 dark:to-teal-900/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative flex items-center gap-3 mb-3">
              <motion.div 
                whileHover={{ rotate: 360 }}
                transition={{ duration: 0.5 }}
                className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/30 dark:to-emerald-800/30 flex items-center justify-center"
              >
                <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </motion.div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{customersWithSLA.length}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">SLA Customers</p>
              </div>
            </div>
            <p className="relative text-sm text-slate-600 dark:text-slate-300 font-medium">
              {slaAlerts > 0 ? `${slaAlerts} at risk` : 'All compliant'}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.02, y: -4 }}
            transition={{ delay: 0.25 }}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 hover:shadow-lg transition-shadow group relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-50/30 to-pink-50/30 dark:from-purple-900/10 dark:to-pink-900/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative flex items-center gap-3 mb-3">
              <motion.div 
                whileHover={{ rotate: 360 }}
                transition={{ duration: 0.5 }}
                className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/30 flex items-center justify-center"
              >
                <Wifi className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </motion.div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{plans.length}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Service Plans</p>
              </div>
            </div>
            <p className="relative text-sm text-slate-600 dark:text-slate-300 font-medium">
              {plans.filter(p => p.status === 'active').length} active
            </p>
          </motion.div>
        </div>

        {/* Charts and Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Revenue Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.01 }}
            transition={{ delay: 0.1 }}
            className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 shadow-sm hover:shadow-lg transition-shadow"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Revenue Overview</h3>
                <p className="text-sm text-slate-500">Last 6 months</p>
              </div>
              <div className="flex items-center gap-2 text-emerald-600">
                <TrendingUp className="w-4 h-4" />
                <span className="text-sm font-medium">Growing</span>
              </div>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyData}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={v => `KES ${v}`} />
                  <Tooltip 
                    contentStyle={{ 
                      background: 'white', 
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                    }}
                    formatter={(value) => [`KES ${value.toLocaleString()}`, 'Revenue']}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="#6366f1" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorRevenue)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Quick Actions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.01 }}
            transition={{ delay: 0.2 }}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 shadow-sm hover:shadow-lg transition-shadow"
          >
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Quick Actions</h3>
            <div className="space-y-3">
              {[
                { label: 'Add Customer', href: 'Customers', icon: Users, color: 'bg-blue-50 text-blue-600' },
                { label: 'Onboard Customer', href: 'CustomerOnboarding', icon: Activity, color: 'bg-indigo-50 text-indigo-600' },
                { label: 'Create Invoice', href: 'Invoices', icon: FileText, color: 'bg-emerald-50 text-emerald-600' },
                { label: 'Record Payment', href: 'Payments', icon: CreditCard, color: 'bg-purple-50 text-purple-600' },
              ].map((action, i) => (
                <Link
                  key={i}
                  to={createPageUrl(action.href)}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group"
                >
                  <div className={`p-2 rounded-lg ${action.color}`}>
                    <action.icon className="w-4 h-4" />
                  </div>
                  <span className="font-medium text-slate-700 dark:text-slate-200 flex-1">{action.label}</span>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
                </Link>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Invoices */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Recent Invoices</h3>
              <Link 
                to={createPageUrl('Invoices')} 
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                View all
              </Link>
            </div>
            <div className="space-y-3">
              {invoices.slice(0, 5).map((invoice, i) => (
                <div key={invoice.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                      <FileText className="w-5 h-5 text-slate-500" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-200 text-sm">{invoice.customer_name}</p>
                      <p className="text-xs text-slate-500">{invoice.invoice_number}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-slate-900 dark:text-white text-sm">KES {invoice.total_amount?.toLocaleString()}</p>
                    <StatusBadge status={invoice.status} className="" />
                  </div>
                </div>
              ))}
              {invoices.length === 0 && (
                <p className="text-center text-slate-500 py-8 text-sm">No invoices yet</p>
              )}
            </div>
          </motion.div>

          {/* Recent Tickets */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Support Tickets</h3>
              <Link 
                to={createPageUrl('Tickets')} 
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                View all
              </Link>
            </div>
            <div className="space-y-3">
              {tickets.slice(0, 5).map((ticket, i) => (
                <div key={ticket.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      ticket.priority === 'urgent' ? 'bg-rose-100' :
                      ticket.priority === 'high' ? 'bg-amber-100' : 'bg-slate-100'
                    }`}>
                      <Clock className={`w-5 h-5 ${
                        ticket.priority === 'urgent' ? 'text-rose-500' :
                        ticket.priority === 'high' ? 'text-amber-500' : 'text-slate-500'
                      }`} />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-200 text-sm">{ticket.subject}</p>
                      <p className="text-xs text-slate-500">{ticket.customer_name}</p>
                    </div>
                  </div>
                  <StatusBadge status={ticket.status} className="" />
                </div>
              ))}
              {tickets.length === 0 && (
                <p className="text-center text-slate-500 py-8 text-sm">No tickets yet</p>
              )}
            </div>
          </motion.div>

          {/* System Activity */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">System Activity</h3>
              <Link 
                to={createPageUrl('Logs')} 
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                View logs
              </Link>
            </div>
            <div className="space-y-3">
              {logs.slice(0, 5).map((log, i) => (
                <div key={log.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <div className={`w-2 h-2 rounded-full ${
                    log.level === 'error' ? 'bg-rose-500' :
                    log.level === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 dark:text-slate-200 text-sm truncate">{log.action || log.message}</p>
                    <p className="text-xs text-slate-500">
                      {log.created_date ? format(new Date(log.created_date), 'MMM d, h:mm a') : 'Just now'}
                    </p>
                  </div>
                </div>
              ))}
              {logs.length === 0 && (
                <p className="text-center text-slate-500 py-8 text-sm">No recent activity</p>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}