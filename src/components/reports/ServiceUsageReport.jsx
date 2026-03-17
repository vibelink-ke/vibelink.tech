import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import ExportButtons from './ReportExporter';
import { Wifi, Users, TrendingUp } from 'lucide-react';

const PLAN_COLORS = {
  'basic': '#6366f1',
  'standard': '#8b5cf6',
  'premium': '#d946ef',
  'enterprise': '#ec4899'
};

export default function ServiceUsageReport({ customers = [], plans = [] }) {
  const [selectedPlan, setSelectedPlan] = useState('all');

  // Service adoption by plan
  const serviceAdoption = useMemo(() => {
    return plans.map(plan => {
      const planCustomers = customers.filter(c => c.plan_id === plan.id);
      const activeCount = planCustomers.filter(c => c.status === 'active').length;
      const suspendedCount = planCustomers.filter(c => c.status === 'suspended').length;
      const pendingCount = planCustomers.filter(c => c.status === 'pending').length;
      
      return {
        name: plan.name,
        plan_id: plan.id,
        total: planCustomers.length,
        active: activeCount,
        suspended: suspendedCount,
        pending: pendingCount,
        adoptionRate: planCustomers.length > 0 ? ((activeCount / planCustomers.length) * 100).toFixed(1) : 0,
        monthlyRevenue: activeCount * (plan.monthly_price || 0),
      };
    });
  }, [customers, plans]);

  // Service plan comparison
  const planComparison = useMemo(() => {
    return plans.map(plan => ({
      name: plan.name,
      download: plan.download_speed || 0,
      upload: plan.upload_speed || 0,
      price: plan.monthly_price || 0,
      users: customers.filter(c => c.plan_id === plan.id && c.status === 'active').length,
    }));
  }, [customers, plans]);

  // Customer distribution by status
  const statusDistribution = useMemo(() => {
    return [
      {
        name: 'Active',
        value: customers.filter(c => c.status === 'active').length,
        color: '#10b981'
      },
      {
        name: 'Suspended',
        value: customers.filter(c => c.status === 'suspended').length,
        color: '#f59e0b'
      },
      {
        name: 'Pending',
        value: customers.filter(c => c.status === 'pending').length,
        color: '#6366f1'
      },
      {
        name: 'Terminated',
        value: customers.filter(c => c.status === 'terminated').length,
        color: '#ef4444'
      },
    ].filter(s => s.value > 0);
  }, [customers]);

  const totalCustomers = customers.length;
  const activeCustomers = customers.filter(c => c.status === 'active').length;
  const totalMRR = serviceAdoption.reduce((sum, plan) => sum + plan.monthlyRevenue, 0);

  const reportData = serviceAdoption.map(plan => ({
    planName: plan.name,
    totalCustomers: plan.total,
    activeCustomers: plan.active,
    suspendedCustomers: plan.suspended,
    pendingCustomers: plan.pending,
    adoptionRate: plan.adoptionRate,
    monthlyRevenue: plan.monthlyRevenue,
  }));

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
            <Label className="mb-2 block">Filter by Plan</Label>
            <Select value={selectedPlan} onValueChange={setSelectedPlan}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Plans</SelectItem>
                {plans.map(plan => (
                  <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <ExportButtons 
              data={reportData}
              columns={['planName', 'totalCustomers', 'activeCustomers', 'adoptionRate', 'monthlyRevenue']}
              title="Service Usage Report"
              filename="service_usage_report"
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
                <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <Users className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-600">Total Customers</p>
                  <p className="text-2xl font-bold text-indigo-600">{totalCustomers}</p>
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
                  <TrendingUp className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-600">Active Customers</p>
                  <p className="text-2xl font-bold text-emerald-600">{activeCustomers}</p>
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
                  <Wifi className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-600">Monthly Recurring Revenue</p>
                  <p className="text-2xl font-bold text-blue-600">${totalMRR.toLocaleString()}</p>
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
              <CardTitle>Customers by Plan</CardTitle>
              <CardDescription>Service adoption distribution</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serviceAdoption}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="active" name="Active" fill="#10b981" />
                    <Bar dataKey="suspended" name="Suspended" fill="#f59e0b" />
                    <Bar dataKey="pending" name="Pending" fill="#6366f1" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card>
            <CardHeader>
              <CardTitle>Customer Status Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusDistribution} cx="50%" cy="50%" outerRadius={80} dataKey="value">
                      {statusDistribution.map((entry, index) => (
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

      {/* Speed Comparison */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <Card>
          <CardHeader>
            <CardTitle>Service Plan Speeds</CardTitle>
            <CardDescription>Download and upload speeds by plan</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={planComparison}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis label={{ value: 'Speed (Mbps)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="download" name="Download (Mbps)" fill="#6366f1" />
                  <Bar dataKey="upload" name="Upload (Mbps)" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Detailed Table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
        <Card>
          <CardHeader>
            <CardTitle>Service Plan Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium text-slate-600">Plan</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Total</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Active</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Adoption %</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">Monthly Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {serviceAdoption.map((plan, i) => (
                    <tr key={i} className="border-b hover:bg-slate-50 dark:hover:bg-slate-700">
                      <td className="py-2 px-3 font-medium">{plan.name}</td>
                      <td className="py-2 px-3 text-right">{plan.total}</td>
                      <td className="py-2 px-3 text-right text-emerald-600 font-semibold">{plan.active}</td>
                      <td className="py-2 px-3 text-right">{plan.adoptionRate}%</td>
                      <td className="py-2 px-3 text-right font-semibold text-indigo-600">${plan.monthlyRevenue.toLocaleString()}</td>
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