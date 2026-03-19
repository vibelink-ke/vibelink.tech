import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { 
  XCircle,
  DollarSign,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  Download
} from 'lucide-react';
import { format, subMonths, startOfMonth, endOfMonth, differenceInHours } from 'date-fns';
import PageHeader from '@/components/shared/PageHeader';
import StatCard from '@/components/shared/StatCard';
import MonthlyRevenueReport from '@/components/reports/MonthlyRevenueReport';
import PaymentHistoryReport from '@/components/reports/PaymentHistoryReport';
import ServiceUsageReport from '@/components/reports/ServiceUsageReport';
import CustomerAcquisitionReport from '@/components/reports/CustomerAcquisitionReport';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  BarChart,
  Bar,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  ComposedChart,
} from 'recharts';

const COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#10b981', '#f59e0b'];

const tooltipStyles = {
  contentStyle: { 
    backgroundColor: 'white', 
    border: '1px solid #e2e8f0', 
    borderRadius: '12px',
    fontSize: '12px'
  },
  itemStyle: { color: '#1e293b' },
  labelStyle: { fontWeight: 'bold', marginBottom: '4px', color: '#1e293b' }
};

export default function Reports() {
  const [period, setPeriod] = useState('6months');
  const [activeTab, setActiveTab] = useState('revenue');
  const [activeReport, setActiveReport] = useState('overview');

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => vibelink.entities.Customer.list(),
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => vibelink.entities.Invoice.list(),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments'],
    queryFn: () => vibelink.entities.Payment.list(),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['plans'],
    queryFn: () => vibelink.entities.ServicePlan.list(),
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => vibelink.entities.SupportTicket.list(),
  });

  const monthCount = period === '3months' ? 3 : period === '6months' ? 6 : 12;

  // ==================== REVENUE ANALYTICS ====================
  const revenueAnalytics = React.useMemo(() => {
    const monthlyData = [];
    let totalRevenue = 0;
    let totalInvoiced = 0;

    for (let i = monthCount - 1; i >= 0; i--) {
      const date = subMonths(new Date(), i);
      const monthStart = startOfMonth(date);
      const monthEnd = endOfMonth(date);
      
      const monthPayments = payments.filter(p => {
        if (!p.created_date) return false;
        const pDate = new Date(p.created_date);
        return pDate >= monthStart && pDate <= monthEnd && p.status === 'completed';
      });
      
      const monthInvoices = invoices.filter(inv => {
        if (!inv.created_date) return false;
        const iDate = new Date(inv.created_date);
        return iDate >= monthStart && iDate <= monthEnd;
      });

      const revenue = monthPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
      const invoiced = monthInvoices.reduce((sum, inv) => sum + (inv.total_amount || 0), 0);
      
      totalRevenue += revenue;
      totalInvoiced += invoiced;
      
      monthlyData.push({
        month: format(date, 'MMM'),
        fullMonth: format(date, 'MMMM yyyy'),
        revenue,
        invoiced,
        collectionRate: invoiced > 0 ? ((revenue / invoiced) * 100).toFixed(1) : 100,
      });
    }

    // Revenue by plan
    const byPlan = plans.map(plan => {
      const planCustomers = customers.filter(c => c.plan_id === plan.id);
      const planPayments = payments.filter(p => 
        planCustomers.some(c => c.id === p.customer_id) && p.status === 'completed'
      );
      return {
        name: plan.name,
        revenue: planPayments.reduce((sum, p) => sum + (p.amount || 0), 0),
        customers: planCustomers.length,
        mrr: planCustomers.filter(c => c.status === 'active').length * (plan.monthly_price || 0),
      };
    }).sort((a, b) => b.revenue - a.revenue);

    // Top customers by revenue
    const customerRevenue = {};
    payments.filter(p => p.status === 'completed').forEach(p => {
      if (p.customer_id) {
        customerRevenue[p.customer_id] = (customerRevenue[p.customer_id] || 0) + (p.amount || 0);
      }
    });
    const topCustomers = Object.entries(customerRevenue)
      .map(([id, revenue]) => {
        const customer = customers.find(c => c.id === id);
        return { id, name: customer?.full_name || 'Unknown', revenue };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return { monthlyData, byPlan, topCustomers, totalRevenue, totalInvoiced };
  }, [payments, invoices, customers, plans, monthCount]);

  // ==================== CHURN ANALYTICS ====================
  const churnAnalytics = React.useMemo(() => {
    const monthlyChurn = [];
    let totalChurned = 0;
    let totalNew = 0;

    for (let i = monthCount - 1; i >= 0; i--) {
      const date = subMonths(new Date(), i);
      const monthStart = startOfMonth(date);
      const monthEnd = endOfMonth(date);

      // Terminated in this month (approximation based on updated_date)
      const churned = customers.filter(c => {
        if (c.status !== 'terminated' || !c.updated_date) return false;
        const uDate = new Date(c.updated_date);
        return uDate >= monthStart && uDate <= monthEnd;
      }).length;

      // New customers this month
      const newCustomers = customers.filter(c => {
        if (!c.created_date) return false;
        const cDate = new Date(c.created_date);
        return cDate >= monthStart && cDate <= monthEnd;
      }).length;

      // Active at start of month (approximation)
      const activeStart = customers.filter(c => {
        if (!c.created_date) return true;
        return new Date(c.created_date) < monthStart;
      }).length || 1;

      totalChurned += churned;
      totalNew += newCustomers;

      monthlyChurn.push({
        month: format(date, 'MMM'),
        churned,
        new: newCustomers,
        net: newCustomers - churned,
        churnRate: ((churned / activeStart) * 100).toFixed(2),
      });
    }

    // Churn by plan
    const churnByPlan = plans.map(plan => {
      const planCustomers = customers.filter(c => c.plan_id === plan.id);
      const terminated = planCustomers.filter(c => c.status === 'terminated').length;
      return {
        name: plan.name,
        total: planCustomers.length,
        terminated,
        churnRate: planCustomers.length > 0 ? ((terminated / planCustomers.length) * 100).toFixed(1) : 0,
      };
    });

    // Customer status distribution
    const statusDist = [
      { name: 'Active', value: customers.filter(c => c.status === 'active').length, color: '#10b981' },
      { name: 'Suspended', value: customers.filter(c => c.status === 'suspended').length, color: '#f59e0b' },
      { name: 'Pending', value: customers.filter(c => c.status === 'pending').length, color: '#6366f1' },
      { name: 'Terminated', value: customers.filter(c => c.status === 'terminated').length, color: '#ef4444' },
    ].filter(s => s.value > 0);

    const overallChurnRate = customers.length > 0 
      ? ((customers.filter(c => c.status === 'terminated').length / customers.length) * 100).toFixed(2)
      : 0;

    return { monthlyChurn, churnByPlan, statusDist, totalChurned, totalNew, overallChurnRate };
  }, [customers, plans, monthCount]);

  // ==================== TICKET ANALYTICS ====================
  const ticketAnalytics = React.useMemo(() => {
    const resolvedTickets = tickets.filter(t => t.status === 'resolved' || t.status === 'closed');
    
    // Resolution times
    const resolutionTimes = resolvedTickets
      .filter(t => t.created_date && t.resolved_date)
      .map(t => {
        const created = new Date(t.created_date);
        const resolved = new Date(t.resolved_date);
        return differenceInHours(resolved, created);
      });

    const avgResolutionHours = resolutionTimes.length > 0 
      ? (resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length).toFixed(1)
      : 0;

    // Monthly ticket stats
    const monthlyTickets = [];
    for (let i = monthCount - 1; i >= 0; i--) {
      const date = subMonths(new Date(), i);
      const monthStart = startOfMonth(date);
      const monthEnd = endOfMonth(date);

      const created = tickets.filter(t => {
        if (!t.created_date) return false;
        const cDate = new Date(t.created_date);
        return cDate >= monthStart && cDate <= monthEnd;
      });

      const resolved = tickets.filter(t => {
        if (!t.resolved_date) return false;
        const rDate = new Date(t.resolved_date);
        return rDate >= monthStart && rDate <= monthEnd;
      });

      monthlyTickets.push({
        month: format(date, 'MMM'),
        created: created.length,
        resolved: resolved.length,
        pending: created.length - resolved.length,
      });
    }

    // By category
    const byCategory = ['billing', 'technical', 'service_request', 'complaint', 'general'].map(cat => ({
      name: cat.replace('_', ' ').charAt(0).toUpperCase() + cat.slice(1).replace('_', ' '),
      total: tickets.filter(t => t.category === cat).length,
      resolved: tickets.filter(t => t.category === cat && (t.status === 'resolved' || t.status === 'closed')).length,
    }));

    // By priority
    const byPriority = [
      { name: 'Low', value: tickets.filter(t => t.priority === 'low').length, color: '#6366f1' },
      { name: 'Medium', value: tickets.filter(t => t.priority === 'medium').length, color: '#f59e0b' },
      { name: 'High', value: tickets.filter(t => t.priority === 'high').length, color: '#f97316' },
      { name: 'Urgent', value: tickets.filter(t => t.priority === 'urgent').length, color: '#ef4444' },
    ].filter(p => p.value > 0);

    // Resolution time distribution
    const resTimeDistribution = [
      { name: '< 1 hour', value: resolutionTimes.filter(t => t < 1).length },
      { name: '1-4 hours', value: resolutionTimes.filter(t => t >= 1 && t < 4).length },
      { name: '4-24 hours', value: resolutionTimes.filter(t => t >= 4 && t < 24).length },
      { name: '1-3 days', value: resolutionTimes.filter(t => t >= 24 && t < 72).length },
      { name: '> 3 days', value: resolutionTimes.filter(t => t >= 72).length },
    ].filter(r => r.value > 0);

    const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;
    const resolutionRate = tickets.length > 0 
      ? ((resolvedTickets.length / tickets.length) * 100).toFixed(1)
      : 0;

    return { 
      monthlyTickets, 
      byCategory, 
      byPriority, 
      avgResolutionHours, 
      resTimeDistribution,
      openTickets,
      totalTickets: tickets.length,
      resolvedTickets: resolvedTickets.length,
      resolutionRate
    };
  }, [tickets, monthCount]);

  // ==================== PAYMENT ANALYTICS ====================
  const paymentAnalytics = React.useMemo(() => {
    const completedPayments = payments.filter(p => p.status === 'completed');
    const failedPayments = payments.filter(p => p.status === 'failed');
    const pendingPayments = payments.filter(p => p.status === 'pending');

    const successRate = payments.length > 0 
      ? ((completedPayments.length / payments.length) * 100).toFixed(1)
      : 100;

    // Monthly payment stats
    const monthlyPayments = [];
    for (let i = monthCount - 1; i >= 0; i--) {
      const date = subMonths(new Date(), i);
      const monthStart = startOfMonth(date);
      const monthEnd = endOfMonth(date);

      const monthPays = payments.filter(p => {
        if (!p.created_date) return false;
        const pDate = new Date(p.created_date);
        return pDate >= monthStart && pDate <= monthEnd;
      });

      const completed = monthPays.filter(p => p.status === 'completed');
      const failed = monthPays.filter(p => p.status === 'failed');

      monthlyPayments.push({
        month: format(date, 'MMM'),
        completed: completed.length,
        failed: failed.length,
        amount: completed.reduce((sum, p) => sum + (p.amount || 0), 0),
        successRate: monthPays.length > 0 ? ((completed.length / monthPays.length) * 100).toFixed(1) : 100,
      });
    }

    // By method
    const byMethod = {};
    payments.forEach(p => {
      const method = p.payment_method || 'other';
      if (!byMethod[method]) {
        byMethod[method] = { total: 0, completed: 0, amount: 0 };
      }
      byMethod[method].total++;
      if (p.status === 'completed') {
        byMethod[method].completed++;
        byMethod[method].amount += p.amount || 0;
      }
    });

    const methodData = Object.entries(byMethod).map(([method, data]) => ({
      name: method.replace('_', ' ').charAt(0).toUpperCase() + method.slice(1).replace('_', ' '),
      transactions: data.total,
      amount: data.amount,
      successRate: data.total > 0 ? ((data.completed / data.total) * 100).toFixed(1) : 0,
    }));

    // Payment status distribution
    const statusDist = [
      { name: 'Completed', value: completedPayments.length, color: '#10b981' },
      { name: 'Pending', value: pendingPayments.length, color: '#f59e0b' },
      { name: 'Failed', value: failedPayments.length, color: '#ef4444' },
      { name: 'Refunded', value: payments.filter(p => p.status === 'refunded').length, color: '#6366f1' },
    ].filter(s => s.value > 0);

    return {
      monthlyPayments,
      methodData,
      statusDist,
      successRate,
      totalPayments: payments.length,
      completedCount: completedPayments.length,
      failedCount: failedPayments.length,
      totalAmount: completedPayments.reduce((sum, p) => sum + (p.amount || 0), 0),
    };
  }, [payments, monthCount]);

  // Key metrics
  const activeCustomers = customers.filter(c => c.status === 'active').length;
  const mrr = plans.reduce((sum, plan) => {
    const planActiveCustomers = customers.filter(c => c.plan_id === plan.id && c.status === 'active').length;
    return sum + (planActiveCustomers * (plan.monthly_price || 0));
  }, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-8 transition-colors duration-500">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Reports & Analytics"
          subtitle="Comprehensive business insights and performance metrics"
          actionLabel="Export Overall Data"
          onAction={() => {}}
          actionIcon={Download}
        >
          <div className="flex items-center gap-4">
            <Select value={activeReport} onValueChange={setActiveReport}>
              <SelectTrigger className="w-56 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200">
                <SelectItem value="overview">Dashboard Overview</SelectItem>
                <SelectItem value="revenue">Monthly Revenue Report</SelectItem>
                <SelectItem value="payments">Payment History Report</SelectItem>
                <SelectItem value="usage">Service Usage Statistics</SelectItem>
                <SelectItem value="acquisition">Customer Acquisition Cost</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </PageHeader>

        {activeReport === 'revenue' && <MonthlyRevenueReport payments={payments} invoices={invoices} />}
        {activeReport === 'payments' && <PaymentHistoryReport payments={payments} />}
        {activeReport === 'usage' && <ServiceUsageReport customers={customers} plans={plans} />}
        {activeReport === 'acquisition' && <CustomerAcquisitionReport customers={customers} payments={payments} plans={plans} />}

        {activeReport === 'overview' && <>
        {/* Key Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            title="Monthly Recurring Revenue"
            value={`$${mrr.toLocaleString()}`}
            subtitle={`${activeCustomers} active subscribers`}
            icon={DollarSign}
          />
          <StatCard
            title="Collection Rate"
            value={`${revenueAnalytics.totalInvoiced > 0 ? ((revenueAnalytics.totalRevenue / revenueAnalytics.totalInvoiced) * 100).toFixed(1) : 100}%`}
            subtitle="Of invoiced amount"
            icon={CreditCard}
            trend={revenueAnalytics.totalRevenue >= revenueAnalytics.totalInvoiced * 0.9 ? "+5%" : "-3%"}
            trendUp={revenueAnalytics.totalRevenue >= revenueAnalytics.totalInvoiced * 0.9}
          />
          <StatCard
            title="Churn Rate"
            value={`${churnAnalytics.overallChurnRate}%`}
            subtitle={`${churnAnalytics.totalChurned} churned / ${churnAnalytics.totalNew} new`}
            icon={TrendingDown}
          />
          <StatCard
            title="Avg Resolution Time"
            value={`${ticketAnalytics.avgResolutionHours}h`}
            subtitle={`${ticketAnalytics.resolutionRate}% resolved`}
            icon={Clock}
          />
        </div>

        {/* Tabs for different reports */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border p-1 flex-wrap h-auto">
            <TabsTrigger value="revenue" className="gap-2">
              <DollarSign className="w-4 h-4" /> Revenue
            </TabsTrigger>
            <TabsTrigger value="churn" className="gap-2">
              <Users className="w-4 h-4" /> Churn Analysis
            </TabsTrigger>
            <TabsTrigger value="tickets" className="gap-2">
              <Clock className="w-4 h-4" /> Ticket Resolution
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-2">
              <CreditCard className="w-4 h-4" /> Payment Success
            </TabsTrigger>
          </TabsList>

          {/* REVENUE TAB */}
          <TabsContent value="revenue" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Monthly Revenue Trend</CardTitle>
                  <CardDescription>Revenue collected vs invoiced amount</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={revenueAnalytics.monthlyData}>
                        <defs>
                          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis yAxisId="left" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                        <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                        <Tooltip 
                          contentStyle={tooltipStyles.contentStyle}
                          itemStyle={tooltipStyles.itemStyle}
                          labelStyle={tooltipStyles.labelStyle}
                          formatter={(value, name) => [
                            name === 'collectionRate' ? `${value}%` : `$${value.toLocaleString()}`,
                            name === 'collectionRate' ? 'Collection Rate' : name.charAt(0).toUpperCase() + name.slice(1)
                          ]}
                        />
                        <Legend iconType="circle" />
                        <Bar yAxisId="left" dataKey="invoiced" name="Invoiced" fill="#f1f5f9" radius={[4, 4, 0, 0]} />
                        <Area yAxisId="left" type="monotone" dataKey="revenue" name="Collected" fill="url(#revenueGradient)" stroke="#6366f1" strokeWidth={2} />
                        <Line yAxisId="right" type="monotone" dataKey="collectionRate" name="Collection %" stroke="#10b981" strokeWidth={2} dot={{ r: 4, fill: '#10b981' }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Revenue by Plan</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={revenueAnalytics.byPlan.filter(p => p.revenue > 0)}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={70}
                          paddingAngle={3}
                          dataKey="revenue"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {revenueAnalytics.byPlan.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => `$${v.toLocaleString()}`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Top 10 Customers by Revenue</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {revenueAnalytics.topCustomers.map((customer, i) => (
                      <div key={customer.id} className="flex items-center gap-3">
                        <span className="text-sm font-medium text-slate-400 w-6">{i + 1}</span>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-900">{customer.name}</span>
                            <span className="font-semibold text-slate-900">${customer.revenue.toLocaleString()}</span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full mt-1">
                            <div 
                              className="h-2 bg-indigo-500 rounded-full"
                              style={{ width: `${(customer.revenue / revenueAnalytics.topCustomers[0]?.revenue) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Plan Performance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 font-medium text-slate-500">Plan</th>
                          <th className="text-right py-3 font-medium text-slate-500">Customers</th>
                          <th className="text-right py-3 font-medium text-slate-500">Revenue</th>
                          <th className="text-right py-3 font-medium text-slate-500">MRR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revenueAnalytics.byPlan.map((plan, i) => (
                          <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                            <td className="py-3 font-medium text-slate-900">{plan.name}</td>
                            <td className="py-3 text-right text-slate-600">{plan.customers}</td>
                            <td className="py-3 text-right text-slate-600">${plan.revenue.toLocaleString()}</td>
                            <td className="py-3 text-right font-semibold text-indigo-600">${plan.mrr.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* CHURN TAB */}
          <TabsContent value="churn" className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <ArrowUpRight className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-emerald-600">+{churnAnalytics.totalNew}</p>
                      <p className="text-xs text-slate-500">New Customers</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-rose-50 flex items-center justify-center">
                      <ArrowDownRight className="w-5 h-5 text-rose-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-rose-600">-{churnAnalytics.totalChurned}</p>
                      <p className="text-xs text-slate-500">Churned</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <Activity className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <p className={`text-2xl font-bold ${churnAnalytics.totalNew - churnAnalytics.totalChurned >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {churnAnalytics.totalNew - churnAnalytics.totalChurned >= 0 ? '+' : ''}{churnAnalytics.totalNew - churnAnalytics.totalChurned}
                      </p>
                      <p className="text-xs text-slate-500">Net Growth</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                      <TrendingDown className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-amber-600">{churnAnalytics.overallChurnRate}%</p>
                      <p className="text-xs text-slate-500">Churn Rate</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Customer Growth Trend</CardTitle>
                  <CardDescription>New vs churned customers over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={churnAnalytics.monthlyChurn}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="month" stroke="#94a3b8" />
                        <YAxis stroke="#94a3b8" />
                        <Tooltip contentStyle={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px' }} />
                        <Legend />
                        <Bar dataKey="new" name="New Customers" fill="#10b981" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="churned" name="Churned" fill="#ef4444" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Customer Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={churnAnalytics.statusDist}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={70}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {churnAnalytics.statusDist.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Churn by Plan</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={churnAnalytics.churnByPlan} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis type="number" stroke="#94a3b8" />
                      <YAxis dataKey="name" type="category" stroke="#94a3b8" width={100} />
                      <Tooltip contentStyle={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px' }} />
                      <Legend />
                      <Bar dataKey="total" name="Total Customers" fill="#6366f1" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="terminated" name="Terminated" fill="#ef4444" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TICKETS TAB */}
          <TabsContent value="tickets" className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <FileText className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{ticketAnalytics.totalTickets}</p>
                      <p className="text-xs text-slate-500">Total Tickets</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-emerald-600">{ticketAnalytics.resolvedTickets}</p>
                      <p className="text-xs text-slate-500">Resolved</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                      <Clock className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-amber-600">{ticketAnalytics.openTickets}</p>
                      <p className="text-xs text-slate-500">Open</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                      <Activity className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-purple-600">{ticketAnalytics.avgResolutionHours}h</p>
                      <p className="text-xs text-slate-500">Avg Resolution</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Ticket Volume Trend</CardTitle>
                  <CardDescription>Created vs resolved tickets over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={ticketAnalytics.monthlyTickets}>
                        <defs>
                          <linearGradient id="createdGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="resolvedGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="month" stroke="#94a3b8" />
                        <YAxis stroke="#94a3b8" />
                        <Tooltip contentStyle={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px' }} />
                        <Legend />
                        <Area type="monotone" dataKey="created" name="Created" fill="url(#createdGradient)" stroke="#f59e0b" strokeWidth={2} />
                        <Area type="monotone" dataKey="resolved" name="Resolved" fill="url(#resolvedGradient)" stroke="#10b981" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>By Priority</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={ticketAnalytics.byPriority}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={70}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {ticketAnalytics.byPriority.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Resolution Time Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={ticketAnalytics.resTimeDistribution}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" stroke="#94a3b8" />
                        <YAxis stroke="#94a3b8" />
                        <Tooltip contentStyle={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px' }} />
                        <Bar dataKey="value" name="Tickets" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Tickets by Category</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {ticketAnalytics.byCategory.map((cat, i) => (
                      <div key={i}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="font-medium">{cat.name}</span>
                          <span className="text-slate-500">{cat.resolved}/{cat.total} resolved</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full">
                          <div 
                            className="h-2 bg-indigo-500 rounded-full"
                            style={{ width: `${cat.total > 0 ? (cat.resolved / cat.total) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* PAYMENTS TAB */}
          <TabsContent value="payments" className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <CreditCard className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{paymentAnalytics.totalPayments}</p>
                      <p className="text-xs text-slate-500">Total Payments</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-emerald-600">{paymentAnalytics.successRate}%</p>
                      <p className="text-xs text-slate-500">Success Rate</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-rose-50 flex items-center justify-center">
                      <XCircle className="w-5 h-5 text-rose-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-rose-600">{paymentAnalytics.failedCount}</p>
                      <p className="text-xs text-slate-500">Failed</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-emerald-600">${paymentAnalytics.totalAmount.toLocaleString()}</p>
                      <p className="text-xs text-slate-500">Total Collected</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Payment Success Trend</CardTitle>
                  <CardDescription>Monthly payment volume and success rate</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={paymentAnalytics.monthlyPayments}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="month" stroke="#94a3b8" />
                        <YAxis yAxisId="left" stroke="#94a3b8" />
                        <YAxis yAxisId="right" orientation="right" stroke="#10b981" tickFormatter={(v) => `${v}%`} />
                        <Tooltip contentStyle={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px' }} />
                        <Legend />
                        <Bar yAxisId="left" dataKey="completed" name="Completed" fill="#10b981" radius={[4, 4, 0, 0]} />
                        <Bar yAxisId="left" dataKey="failed" name="Failed" fill="#ef4444" radius={[4, 4, 0, 0]} />
                        <Line yAxisId="right" type="monotone" dataKey="successRate" name="Success Rate %" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Payment Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={paymentAnalytics.statusDist}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={70}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {paymentAnalytics.statusDist.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Performance by Payment Method</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 font-medium text-slate-500">Method</th>
                        <th className="text-right py-3 px-4 font-medium text-slate-500">Transactions</th>
                        <th className="text-right py-3 px-4 font-medium text-slate-500">Amount</th>
                        <th className="text-right py-3 px-4 font-medium text-slate-500">Success Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentAnalytics.methodData.map((method, i) => (
                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-4 font-medium">{method.name}</td>
                          <td className="py-3 px-4 text-right">{method.transactions}</td>
                          <td className="py-3 px-4 text-right">${method.amount.toLocaleString()}</td>
                          <td className="py-3 px-4 text-right">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              parseFloat(method.successRate) >= 90 ? 'bg-emerald-100 text-emerald-700' :
                              parseFloat(method.successRate) >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
                            }`}>
                              {method.successRate}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        </>}
      </div>
    </div>
  );
}