import React, { useState } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, AlertCircle, Users, DollarSign, CreditCard } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';

export default function TenantBillingAnalytics() {
  const [selectedTenant, setSelectedTenant] = useState(null);

  const { data: tenants = [] } = useQuery({
    queryKey: ['all-tenants'],
    queryFn: () => vibelink.asServiceRole.entities.Tenant.list('-updated_date', 100)
  });

  const { data: allPayments = [] } = useQuery({
    queryKey: ['all-payments'],
    queryFn: () => vibelink.asServiceRole.entities.TenantPayment.list('-created_date', 500)
  });

  const { data: allInvoices = [] } = useQuery({
    queryKey: ['all-invoices'],
    queryFn: () => vibelink.asServiceRole.entities.Invoice.list('-created_date', 500)
  });

  // Calculate overall metrics
  const totalRevenue = allPayments
    .filter(p => p.status === 'completed')
    .reduce((sum, p) => sum + p.amount, 0);

  const totalDue = allInvoices
    .filter(i => i.status === 'sent' || i.status === 'overdue')
    .reduce((sum, i) => sum + i.total_amount, 0);

  const overdue = allInvoices.filter(i => {
    const isOverdue = new Date(i.due_date) < new Date();
    return isOverdue && i.status !== 'paid';
  });

  const activeTenants = tenants.filter(t => t.status === 'active').length;

  // Revenue trend (last 6 months)
  const revenueTrend = Array.from({ length: 6 }).map((_, i) => {
    const month = subMonths(new Date(), 5 - i);
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);

    const monthPayments = allPayments.filter(p => {
      const payDate = new Date(p.created_date);
      return payDate >= monthStart && payDate <= monthEnd && p.status === 'completed';
    });

    return {
      month: format(month, 'MMM'),
      revenue: monthPayments.reduce((sum, p) => sum + p.amount, 0),
      count: monthPayments.length
    };
  });

  // Top tenants by revenue
  const tenantRevenue = tenants.map(tenant => {
    const payments = allPayments.filter(p => p.tenant_id === tenant.id && p.status === 'completed');
    const revenue = payments.reduce((sum, p) => sum + p.amount, 0);
    const invoices = allInvoices.filter(i => i.customer_id === tenant.id);
    const outstanding = invoices
      .filter(i => i.status === 'sent' || i.status === 'overdue')
      .reduce((sum, i) => sum + i.total_amount, 0);

    return {
      id: tenant.id,
      name: tenant.company_name,
      status: tenant.status,
      plan: tenant.subscription_plan,
      revenue,
      outstanding,
      invoiceCount: invoices.length,
      paymentCount: payments.length
    };
  }).sort((a, b) => b.revenue - a.revenue);

  // Payment status distribution
  const paymentStatus = {
    completed: allPayments.filter(p => p.status === 'completed').length,
    pending: allPayments.filter(p => p.status === 'pending').length,
    failed: allPayments.filter(p => p.status === 'failed').length
  };

  // Invoice status distribution
  const invoiceStatus = {
    paid: allInvoices.filter(i => i.status === 'paid').length,
    sent: allInvoices.filter(i => i.status === 'sent').length,
    overdue: overdue.length,
    draft: allInvoices.filter(i => i.status === 'draft').length
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-8 transition-colors duration-500">
      <div className="max-w-7xl mx-auto space-y-8">
        <PageHeader 
          title="Tenant Billing Analytics" 
          subtitle="Monitor and analyze billing performance across all tenants"
        />

        {/* Main Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="dark:bg-slate-900 dark:border-slate-800">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Total Revenue</p>
                  <DollarSign className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <p className="text-3xl font-bold text-slate-900 dark:text-white">
                  KES {(totalRevenue / 1000).toFixed(1)}K
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
                  {allPayments.filter(p => p.status === 'completed').length} payments
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="dark:bg-slate-900 dark:border-slate-800">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Amount Due</p>
                  <AlertCircle className={`w-4 h-4 ${totalDue > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`} />
                </div>
                <p className={`text-3xl font-bold ${totalDue > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>
                  KES {(totalDue / 1000).toFixed(1)}K
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
                  {overdue.length} overdue invoices
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className="dark:bg-slate-900 dark:border-slate-800">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Active Tenants</p>
                  <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                </div>
                <p className="text-3xl font-bold text-slate-900 dark:text-white">
                  {activeTenants}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
                  of {tenants.length} total
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card className="dark:bg-slate-900 dark:border-slate-800">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Collection Rate</p>
                  <TrendingUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <p className="text-3xl font-bold text-slate-900 dark:text-white">
                  {allInvoices.length > 0 ? Math.round((invoiceStatus.paid / allInvoices.length) * 100) : 0}%
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
                  {invoiceStatus.paid} of {allInvoices.length} invoices paid
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Charts and Tables */}
        <Tabs defaultValue="revenue" className="space-y-6">
          <TabsList className="bg-white dark:bg-slate-900 border dark:border-slate-800 p-1">
            <TabsTrigger value="revenue" className="dark:text-slate-400 dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-white">
              Revenue Trend
            </TabsTrigger>
            <TabsTrigger value="tenants" className="dark:text-slate-400 dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-white">
              Tenant Breakdown
            </TabsTrigger>
            <TabsTrigger value="status" className="dark:text-slate-400 dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-white">
              Status Distribution
            </TabsTrigger>
          </TabsList>

          <TabsContent value="revenue">
            <Card className="dark:bg-slate-900 dark:border-slate-800">
              <CardHeader>
                <CardTitle className="dark:text-white">Revenue Trend (Last 6 Months)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={revenueTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="dark:stroke-slate-800" />
                    <XAxis dataKey="month" tick={{ fill: '#64748b' }} />
                    <YAxis tick={{ fill: '#64748b' }} />
                    <Tooltip 
                      formatter={(value) => `KES ${value.toLocaleString('en-KE')}`} 
                      contentStyle={{ 
                        background: 'rgb(15 23 42)', 
                        border: '1px solid rgb(30 41 59)',
                        borderRadius: '12px',
                        color: 'white',
                        fontSize: '12px'
                      }}
                      itemStyle={{ color: '#cbd5e1' }}
                      labelStyle={{ fontWeight: 'bold', marginBottom: '4px', color: '#f8fafc' }}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="revenue" 
                      stroke="#4f46e5" 
                      strokeWidth={2}
                      name="Monthly Revenue"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tenants">
            <Card className="dark:bg-slate-900 dark:border-slate-800">
              <CardHeader>
                <CardTitle className="dark:text-white">Top Tenants by Revenue</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {tenantRevenue.slice(0, 10).map((tenant, idx) => (
                    <motion.div
                      key={tenant.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="flex items-center justify-between p-4 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <p className="font-semibold text-slate-900 dark:text-white">{tenant.name}</p>
                          <Badge variant="outline" className={
                            tenant.status === 'active' 
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" 
                            : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-400"
                          }>
                            {tenant.status}
                          </Badge>
                          <span className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400 px-2 py-1 rounded">
                            {tenant.plan}
                          </span>
                        </div>
                        <div className="flex gap-4 text-sm text-slate-600 dark:text-slate-500">
                          <span>{tenant.paymentCount} payments</span>
                          <span>{tenant.invoiceCount} invoices</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          KES {tenant.revenue.toLocaleString('en-KE')}
                        </p>
                        {tenant.outstanding > 0 && (
                          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                            Due: KES {tenant.outstanding.toLocaleString('en-KE')}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="status">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="dark:bg-slate-900 dark:border-slate-800">
                <CardHeader>
                  <CardTitle className="dark:text-white">Invoice Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={[
                      { name: 'Paid', value: invoiceStatus.paid },
                      { name: 'Sent', value: invoiceStatus.sent },
                      { name: 'Overdue', value: invoiceStatus.overdue },
                      { name: 'Draft', value: invoiceStatus.draft }
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" className="dark:stroke-slate-800" />
                      <XAxis dataKey="name" tick={{ fill: '#64748b' }} />
                      <YAxis tick={{ fill: '#64748b' }} />
                      <Tooltip 
                        contentStyle={{ 
                          background: 'rgb(15 23 42)', 
                          border: '1px solid rgb(30 41 59)',
                          borderRadius: '12px',
                          color: 'white',
                          fontSize: '12px'
                        }}
                        itemStyle={{ color: '#cbd5e1' }}
                        labelStyle={{ fontWeight: 'bold', marginBottom: '4px', color: '#f8fafc' }}
                      />
                      <Bar dataKey="value" fill="#4f46e5" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="dark:bg-slate-900 dark:border-slate-800">
                <CardHeader>
                  <CardTitle className="dark:text-white">Payment Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-lg bg-green-50 dark:bg-green-900/20">
                      <div>
                        <p className="font-semibold text-green-900 dark:text-green-400">Completed</p>
                        <p className="text-sm text-green-700 dark:text-green-500">{paymentStatus.completed} payments</p>
                      </div>
                      <p className="text-2xl font-bold text-green-600 dark:text-green-400">{paymentStatus.completed}</p>
                    </div>
                    <div className="flex items-center justify-between p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20">
                      <div>
                        <p className="font-semibold text-yellow-900 dark:text-yellow-400">Pending</p>
                        <p className="text-sm text-yellow-700 dark:text-yellow-500">{paymentStatus.pending} payments</p>
                      </div>
                      <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{paymentStatus.pending}</p>
                    </div>
                    <div className="flex items-center justify-between p-4 rounded-lg bg-red-50 dark:bg-red-900/20">
                      <div>
                        <p className="font-semibold text-red-900 dark:text-red-400">Failed</p>
                        <p className="text-sm text-red-700 dark:text-red-500">{paymentStatus.failed} payments</p>
                      </div>
                      <p className="text-2xl font-bold text-red-600 dark:text-red-400">{paymentStatus.failed}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}