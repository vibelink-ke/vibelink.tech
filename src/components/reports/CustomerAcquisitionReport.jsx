import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import ExportButtons from './ReportExporter';
import { Users, TrendingUp, DollarSign, Calendar } from 'lucide-react';

export default function CustomerAcquisitionReport({ customers = [], payments = [], plans = [] }) {
  const [monthCount, setMonthCount] = useState(6);

  // Calculate CAC by month
  const cacData = useMemo(() => {
    const data = [];
    
    for (let i = monthCount - 1; i >= 0; i--) {
      const date = subMonths(new Date(), i);
      const monthStart = startOfMonth(date);
      const monthEnd = endOfMonth(date);
      
      // New customers this month
      const newCustomers = customers.filter(c => {
        if (!c.created_date) return false;
        const cDate = new Date(c.created_date);
        return cDate >= monthStart && cDate <= monthEnd;
      });

      // Revenue from those new customers
      const newCustomerRevenue = payments.filter(p => {
        const customer = customers.find(c => c.id === p.customer_id);
        if (!customer || !customer.created_date) return false;
        const cDate = new Date(customer.created_date);
        const pDate = new Date(p.created_date);
        return cDate >= monthStart && cDate <= monthEnd && pDate >= monthStart && pDate <= monthEnd && p.status === 'completed';
      }).reduce((sum, p) => sum + (p.amount || 0), 0);

      // Estimated acquisition cost (revenue / 12 months / new customers)
      const cac = newCustomers.length > 0 
        ? Math.round((newCustomerRevenue / newCustomers.length / 12) * 100) / 100
        : 0;

      data.push({
        month: format(date, 'MMM yyyy'),
        newCustomers: newCustomers.length,
        revenue: Math.round(newCustomerRevenue),
        cac: cac,
        ltv: newCustomers.length > 0 ? Math.round((newCustomerRevenue / newCustomers.length) * 100) / 100 : 0,
      });
    }
    
    return data;
  }, [customers, payments, monthCount]);

  // Customer acquisition by plan
  const acquisitionByPlan = useMemo(() => {
    return plans.map(plan => {
      const planCustomers = customers.filter(c => c.plan_id === plan.id);
      const activeCount = planCustomers.filter(c => c.status === 'active').length;
      
      const planRevenue = payments.filter(p => {
        const customer = customers.find(c => c.id === p.customer_id && c.plan_id === plan.id);
        return customer && p.status === 'completed';
      }).reduce((sum, p) => sum + (p.amount || 0), 0);

      const cac = planCustomers.length > 0 ? Math.round((planRevenue / planCustomers.length / 12) * 100) / 100 : 0;
      const ltv = planCustomers.length > 0 ? Math.round((planRevenue / planCustomers.length) * 100) / 100 : 0;

      return {
        name: plan.name,
        acquisitions: planCustomers.length,
        active: activeCount,
        retention: planCustomers.length > 0 ? ((activeCount / planCustomers.length) * 100).toFixed(1) : 0,
        cac,
        ltv,
        ratio: cac > 0 ? (ltv / cac).toFixed(1) : 0,
      };
    });
  }, [customers, payments, plans]);

  const totalNewCustomers = customers.filter(c => c.created_date).length;
  const totalRevenue = payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + (p.amount || 0), 0);
  const avgCAC = totalNewCustomers > 0 ? Math.round((totalRevenue / totalNewCustomers / 12) * 100) / 100 : 0;
  const totalLTV = totalNewCustomers > 0 ? Math.round((totalRevenue / totalNewCustomers) * 100) / 100 : 0;

  // Acquisition trend (cumulative)
  const cumulativeAcquisition = useMemo(() => {
    let cumulative = 0;
    return cacData.map(d => ({
      ...d,
      cumulative: (cumulative += d.newCustomers),
    }));
  }, [cacData]);

  const reportData = acquisitionByPlan.map(plan => ({
    planName: plan.name,
    acquisitions: plan.acquisitions,
    activeCustomers: plan.active,
    retentionRate: plan.retention,
    cac: plan.cac,
    ltv: plan.ltv,
    ltcRatio: plan.ratio,
  }));

  return (
    <div className="space-y-6">
      {/* Filters */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-lg border border-slate-200 p-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <Label className="mb-2 block">Report Period</Label>
            <Select value={String(monthCount)} onValueChange={(v) => setMonthCount(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">Last 3 Months</SelectItem>
                <SelectItem value="6">Last 6 Months</SelectItem>
                <SelectItem value="12">Last 12 Months</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <ExportButtons 
              data={reportData}
              columns={['planName', 'acquisitions', 'activeCustomers', 'cac', 'ltv', 'ltcRatio']}
              title="Customer Acquisition Report"
              filename="customer_acquisition_report"
            />
          </div>
        </div>
      </motion.div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <Users className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-600">Total Acquisitions</p>
                  <p className="text-2xl font-bold text-indigo-600">{totalNewCustomers}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-600">Avg CAC</p>
                  <p className="text-2xl font-bold text-emerald-600">${avgCAC.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-600">Avg LTV</p>
                  <p className="text-2xl font-bold text-blue-600">${totalLTV.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-600">LTV/CAC Ratio</p>
                  <p className="text-2xl font-bold text-purple-600">
                    {avgCAC > 0 ? (totalLTV / avgCAC).toFixed(1) : '0'}x
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card>
            <CardHeader>
              <CardTitle>CAC & LTV Trend</CardTitle>
              <CardDescription>Monthly customer acquisition cost and lifetime value</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cacData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis yAxisId="left" tickFormatter={(v) => `$${v}`} />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip formatter={(v) => `$${v}`} />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="cac" name="CAC" stroke="#6366f1" strokeWidth={2} />
                    <Line yAxisId="left" type="monotone" dataKey="ltv" name="LTV" stroke="#10b981" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="newCustomers" name="New Customers" stroke="#f59e0b" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card>
            <CardHeader>
              <CardTitle>Cumulative Customer Growth</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cumulativeAcquisition}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="cumulative" name="Cumulative" fill="#6366f1" />
                    <Bar dataKey="newCustomers" name="New This Month" fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Detailed Table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <Card>
          <CardHeader>
            <CardTitle>Acquisition Metrics by Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium text-slate-600">Plan</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Acquisitions</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Retention %</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">CAC</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">LTV</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">LTV/CAC</th>
                  </tr>
                </thead>
                <tbody>
                  {acquisitionByPlan.map((plan, i) => (
                    <tr key={i} className="border-b hover:bg-slate-50">
                      <td className="py-2 px-3 font-medium">{plan.name}</td>
                      <td className="py-2 px-3 text-right">{plan.acquisitions}</td>
                      <td className="py-2 px-3 text-right">{plan.retention}%</td>
                      <td className="py-2 px-3 text-right">${plan.cac.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right font-semibold text-emerald-600">${plan.ltv.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right font-semibold text-indigo-600">{plan.ratio}x</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}