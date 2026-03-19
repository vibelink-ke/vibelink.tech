import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import ExportButtons from './ReportExporter';

export default function MonthlyRevenueReport({ payments = [], invoices = [] }) {
  const [monthCount, setMonthCount] = useState(6);

  const revenueData = useMemo(() => {
    const data = [];
    
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
      
      data.push({
        month: format(date, 'MMM yyyy'),
        revenue: Math.round(revenue),
        invoiced: Math.round(invoiced),
        collectionRate: invoiced > 0 ? parseFloat(((revenue / invoiced) * 100).toFixed(1)) : 100,
        transactionCount: monthPayments.length,
      });
    }
    
    return data;
  }, [payments, invoices, monthCount]);

  const totalRevenue = revenueData.reduce((sum, d) => sum + d.revenue, 0);
  const avgMonthlyRevenue = (totalRevenue / revenueData.length).toFixed(0);

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
              data={revenueData}
              columns={['month', 'revenue', 'invoiced', 'collectionRate', 'transactionCount']}
              title="Monthly Revenue Report"
              filename="monthly_revenue_report"
            />
          </div>
        </div>
      </motion.div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-slate-600 mb-1">Total Revenue</p>
                <p className="text-3xl font-bold text-indigo-600">${totalRevenue.toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-2">{monthCount} months</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-slate-600 mb-1">Avg Monthly Revenue</p>
                <p className="text-3xl font-bold text-emerald-600">${avgMonthlyRevenue.toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-2">Per month</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-slate-600 mb-1">Avg Collection Rate</p>
                <p className="text-3xl font-bold text-blue-600">
                  {(revenueData.reduce((sum, d) => sum + d.collectionRate, 0) / revenueData.length).toFixed(1)}%
                </p>
                <p className="text-xs text-slate-500 mt-2">Payment collection</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Chart */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card>
          <CardHeader>
            <CardTitle>Revenue Trend</CardTitle>
            <CardDescription>Monthly revenue collected vs invoiced</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={revenueData}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" />
                  <YAxis yAxisId="left" tickFormatter={(v) => `$${v/1000}k`} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v, name) => name === 'collectionRate' ? `${v}%` : `$${v}`} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="invoiced" name="Invoiced" fill="#e2e8f0" />
                  <Area yAxisId="left" type="monotone" dataKey="revenue" name="Collected" fill="url(#revenueGradient)" stroke="#6366f1" strokeWidth={2} />
                  <Line yAxisId="right" type="monotone" dataKey="collectionRate" name="Collection %" stroke="#10b981" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Card>
          <CardHeader>
            <CardTitle>Detailed Revenue Data</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium text-slate-600">Month</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Invoiced</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Collected</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Collection %</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Transactions</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueData.map((row, i) => (
                    <tr key={i} className="border-b hover:bg-slate-50">
                      <td className="py-2 px-3 font-medium">{row.month}</td>
                      <td className="py-2 px-3 text-right">${row.invoiced.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right font-semibold text-indigo-600">${row.revenue.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right">{row.collectionRate}%</td>
                      <td className="py-2 px-3 text-right text-slate-600">{row.transactionCount}</td>
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