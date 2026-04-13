import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import PageHeader from '@/components/shared/PageHeader';
import KPIMetric from '@/components/analytics/KPIMetric';
import ChartContainer from '@/components/analytics/ChartContainer';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
  Users, TrendingUp, Activity, Wifi, Clock
} from 'lucide-react';
import { startOfMonth, subMonths } from 'date-fns';

export default function Analytics() {
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

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => vibelink.entities.SupportTicket.list(),
  });

  const { data: outages = [] } = useQuery({
    queryKey: ['outages'],
    queryFn: () => vibelink.entities.Outage.list(),
  });

  // Calculate KPIs
  const kpis = useMemo(() => {
    // Total revenue
    const totalRevenue = payments.reduce((sum, p) => sum + (p.status === 'completed' ? p.amount : 0), 0);
    const activeCustomers = customers.filter(c => c.status === 'active').length;
    const totalInvoiced = invoices.reduce((sum, i) => sum + i.total_amount, 0);

    // ARPU (Average Revenue Per User)
    const arpu = activeCustomers > 0 ? totalRevenue / activeCustomers : 0;

    // Customer Acquisition Cost (estimate from recent new customers)
    const recentNewCustomers = customers.filter(c => {
      const createdDate = new Date(c.created_date);
      return createdDate > subMonths(new Date(), 1);
    }).length;

    // Churn Rate (suspended/terminated customers in last month)
    const churnedCustomers = customers.filter(c => {
      const updatedDate = new Date(c.updated_date);
      return (c.status === 'suspended' || c.status === 'terminated') &&
        updatedDate > subMonths(new Date(), 1);
    }).length;
    const churnRate = activeCustomers > 0 ? (churnedCustomers / activeCustomers) * 100 : 0;

    // Ticket Resolution Time (average)
    const resolvedTickets = tickets.filter(t => t.status === 'closed' || t.status === 'resolved');
    let avgResolutionTime = 0;
    if (resolvedTickets.length > 0) {
      const totalTime = resolvedTickets.reduce((sum, t) => {
        const created = new Date(t.created_date);
        const resolved = new Date(t.resolved_date || new Date());
        return sum + (resolved - created) / (1000 * 60 * 60); // hours
      }, 0);
      avgResolutionTime = totalTime / resolvedTickets.length;
    }

    // Network Uptime (based on outages)
    const totalOutageDuration = outages
      .filter(o => o.actual_resolution)
      .reduce((sum, o) => {
        const start = new Date(o.created_date);
        const end = new Date(o.actual_resolution);
        return sum + (end - start) / (1000 * 60 * 60); // hours
      }, 0);
    const uptime = 100 - Math.min((totalOutageDuration / (30 * 24)) * 100, 100); // estimate for 30 days

    // Payment Collection Rate
    const totalPaid = payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + p.amount, 0);
    const collectionRate = totalInvoiced > 0 ? (totalPaid / totalInvoiced) * 100 : 0;

    return {
      totalRevenue,
      activeCustomers,
      arpu,
      churnRate,
      avgResolutionTime,
      uptime,
      collectionRate,
      totalInvoiced,
      recentNewCustomers,
    };
  }, [customers, invoices, payments, tickets, outages]);

  // Monthly data for charts
  const monthlyData = useMemo(() => {
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const monthDate = subMonths(new Date(), i);
      const monthStart = startOfMonth(monthDate);
      const monthEnd = startOfMonth(subMonths(monthDate, -1));

      const monthCustomers = customers.filter(c => {
        const createdDate = new Date(c.created_date);
        return createdDate >= monthStart && createdDate < monthEnd;
      }).length;

      const monthRevenue = payments
        .filter(p => {
          const paidDate = new Date(p.created_date);
          return paidDate >= monthStart && paidDate < monthEnd && p.status === 'completed';
        })
        .reduce((sum, p) => sum + p.amount, 0);

      const monthTickets = tickets.filter(t => {
        const createdDate = new Date(t.created_date);
        return createdDate >= monthStart && createdDate < monthEnd;
      }).length;

      months.push({
        month: monthDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        customers: monthCustomers,
        revenue: Math.round(monthRevenue),
        tickets: monthTickets,
      });
    }
    return months;
  }, [customers, payments, tickets]);

  return (
    <div className="p-6 space-y-8">
      <PageHeader
        title="Analytics Dashboard"
        subtitle="Track key performance indicators for your ISP business"
      />

      {/* KPI Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPIMetric
          label="Total Revenue"
          value={`KES ${(kpis.totalRevenue / 1000).toFixed(0)}K`}
          Icon={TrendingUp}
          color="green"
        />
        <KPIMetric
          label="Active Customers"
          value={kpis.activeCustomers}
          Icon={Users}
          color="blue"
        />
        <KPIMetric
          label="ARPU"
          value={`KES ${kpis.arpu.toFixed(0)}`}
          Icon={Activity}
          color="purple"
        />
        <KPIMetric
          label="Churn Rate"
          value={kpis.churnRate.toFixed(2)}
          unit="%"
          Icon={TrendingUp}
          color="orange"
          trend={-kpis.churnRate}
        />
        <KPIMetric
          label="Network Uptime"
          value={kpis.uptime.toFixed(2)}
          unit="%"
          Icon={Wifi}
          color="indigo"
        />
      </div>

      {/* Additional Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPIMetric
          label="Avg. Ticket Resolution"
          value={kpis.avgResolutionTime.toFixed(1)}
          unit="hours"
          Icon={Clock}
          color="blue"
        />
        <KPIMetric
          label="Collection Rate"
          value={kpis.collectionRate.toFixed(1)}
          unit="%"
          Icon={TrendingUp}
          color="green"
        />
        <KPIMetric
          label="New Customers (30d)"
          value={kpis.recentNewCustomers}
          Icon={Users}
          color="purple"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartContainer title="Monthly Customer Acquisition">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="customers" fill="#6366f1" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>

        <ChartContainer title="Monthly Revenue Trend">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={monthlyData}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#10b981"
                fillOpacity={1}
                fill="url(#colorRevenue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>

        <ChartContainer title="Support Tickets by Month">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="tickets" stroke="#f59e0b" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>

        <ChartContainer title="Key Metrics Summary">
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-3 border-b">
              <span className="text-slate-600 dark:text-slate-400">Collection Rate</span>
              <span className="font-semibold">{kpis.collectionRate.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between items-center pb-3 border-b">
              <span className="text-slate-600 dark:text-slate-400">Avg Ticket Resolution</span>
              <span className="font-semibold">{kpis.avgResolutionTime.toFixed(1)} hrs</span>
            </div>
            <div className="flex justify-between items-center pb-3 border-b">
              <span className="text-slate-600 dark:text-slate-400">Network Uptime</span>
              <span className="font-semibold">{kpis.uptime.toFixed(2)}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-400">Total Invoiced</span>
              <span className="font-semibold">KES {(kpis.totalInvoiced / 1000).toFixed(0)}K</span>
            </div>
          </div>
        </ChartContainer>
      </div>
    </div>
  );
}