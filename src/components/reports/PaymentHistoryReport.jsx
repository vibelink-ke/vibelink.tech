import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import ExportButtons from './ReportExporter';
import { CheckCircle, XCircle, Clock } from 'lucide-react';

const COLORS = ['#10b981', '#ef4444', '#f59e0b', '#6366f1'];

export default function PaymentHistoryReport({ payments = [] }) {
  const [monthCount, setMonthCount] = useState(6);
  const [filterStatus, setFilterStatus] = useState('all');

  const paymentData = useMemo(() => {
    const data = [];
    
    for (let i = monthCount - 1; i >= 0; i--) {
      const date = subMonths(new Date(), i);
      const monthStart = startOfMonth(date);
      const monthEnd = endOfMonth(date);
      
      const monthPayments = payments.filter(p => {
        if (!p.created_date) return false;
        const pDate = new Date(p.created_date);
        return pDate >= monthStart && pDate <= monthEnd;
      });

      const completed = monthPayments.filter(p => p.status === 'completed').length;
      const failed = monthPayments.filter(p => p.status === 'failed').length;
      const pending = monthPayments.filter(p => p.status === 'pending').length;
      const total = monthPayments.length;
      const amount = monthPayments.filter(p => p.status === 'completed').reduce((sum, p) => sum + (p.amount || 0), 0);
      
      data.push({
        month: format(date, 'MMM yyyy'),
        completed,
        failed,
        pending,
        total,
        amount: Math.round(amount),
        successRate: total > 0 ? ((completed / total) * 100).toFixed(1) : 100,
      });
    }
    
    return data;
  }, [payments, monthCount]);

  const statusBreakdown = useMemo(() => {
    const completed = payments.filter(p => p.status === 'completed').length;
    const failed = payments.filter(p => p.status === 'failed').length;
    const pending = payments.filter(p => p.status === 'pending').length;
    const refunded = payments.filter(p => p.status === 'refunded').length;
    
    return [
      { name: 'Completed', value: completed, color: '#10b981' },
      { name: 'Failed', value: failed, color: '#ef4444' },
      { name: 'Pending', value: pending, color: '#f59e0b' },
      { name: 'Refunded', value: refunded, color: '#6366f1' },
    ].filter(s => s.value > 0);
  }, [payments]);

  const paymentMethods = useMemo(() => {
    const methods = {};
    payments.forEach(p => {
      const method = p.payment_method || 'other';
      if (!methods[method]) {
        methods[method] = { total: 0, completed: 0, failed: 0, amount: 0 };
      }
      methods[method].total++;
      if (p.status === 'completed') {
        methods[method].completed++;
        methods[method].amount += p.amount || 0;
      } else if (p.status === 'failed') {
        methods[method].failed++;
      }
    });
    
    return Object.entries(methods).map(([name, data]) => ({
      name: name.replace('_', ' ').charAt(0).toUpperCase() + name.slice(1).replace('_', ' '),
      ...data,
      successRate: data.total > 0 ? ((data.completed / data.total) * 100).toFixed(1) : 0,
    }));
  }, [payments]);

  const totalCompleted = payments.filter(p => p.status === 'completed').length;
  const successRate = payments.length > 0 ? ((totalCompleted / payments.length) * 100).toFixed(1) : 100;
  const totalAmount = payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + (p.amount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6"
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
              data={paymentData}
              columns={['month', 'completed', 'failed', 'pending', 'amount', 'successRate']}
              title="Payment History Report"
              filename="payment_history_report"
            />
          </div>
        </div>
      </motion.div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-600">Success Rate</p>
                  <p className="text-2xl font-bold text-emerald-600">{successRate}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-600">Total Collected</p>
                  <p className="text-2xl font-bold text-indigo-600">${totalAmount.toLocaleString()}</p>
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
                  <XCircle className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-600">Total Payments</p>
                  <p className="text-2xl font-bold text-blue-600">{payments.length}</p>
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
              <CardTitle>Payment Success Trend</CardTitle>
              <CardDescription>Monthly payment success rate</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={paymentData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="completed" name="Completed" fill="#10b981" />
                    <Bar dataKey="failed" name="Failed" fill="#ef4444" />
                    <Bar dataKey="pending" name="Pending" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card>
            <CardHeader>
              <CardTitle>Payment Status Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusBreakdown} cx="50%" cy="50%" outerRadius={80} dataKey="value">
                      {statusBreakdown.map((entry, index) => (
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
        </motion.div>
      </div>

      {/* Payment Methods */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <Card>
          <CardHeader>
            <CardTitle>Payment Methods Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium text-slate-600">Method</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Total</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Completed</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Failed</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Amount</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Success Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentMethods.map((method, i) => (
                    <tr key={i} className="border-b hover:bg-slate-50 dark:hover:bg-slate-700">
                      <td className="py-2 px-3 font-medium">{method.name}</td>
                      <td className="py-2 px-3 text-right">{method.total}</td>
                      <td className="py-2 px-3 text-right text-emerald-600">{method.completed}</td>
                      <td className="py-2 px-3 text-right text-red-600">{method.failed}</td>
                      <td className="py-2 px-3 text-right font-semibold">${method.amount.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                          parseFloat(method.successRate) >= 80 ? 'bg-emerald-100 text-emerald-700' :
                          parseFloat(method.successRate) >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
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
      </motion.div>
    </div>
  );
}