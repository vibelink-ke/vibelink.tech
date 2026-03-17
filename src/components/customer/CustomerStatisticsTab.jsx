import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { motion } from 'framer-motion';
import { TrendingUp, Download, Upload, Zap } from 'lucide-react';

// Mock data - in production, this would come from actual usage data
const dailyData = [
  { day: 'Mon', download: 0, upload: 0, date: '2024-02-19' },
  { day: 'Tue', download: 0, upload: 0, date: '2024-02-20' },
  { day: 'Wed', download: 0, upload: 0, date: '2024-02-21' },
  { day: 'Thu', download: 0, upload: 0, date: '2024-02-22' },
  { day: 'Fri', download: 0, upload: 0, date: '2024-02-23' },
  { day: 'Sat', download: 0, upload: 0, date: '2024-02-24' },
  { day: 'Sun', download: 0, upload: 0, date: '2024-02-25' },
];

const weeklyData = [
  { week: 'Week 1', download: 0, upload: 0 },
  { week: 'Week 2', download: 0, upload: 0 },
  { week: 'Week 3', download: 0, upload: 0 },
  { week: 'Week 4', download: 0, upload: 0 },
];

const monthlyData = [
  { month: 'Jan', download: 0, upload: 0 },
  { month: 'Feb', download: 0, upload: 0 },
];

const usageBreakdown = [
  { name: 'Download', value: 0, color: '#3b82f6' },
  { name: 'Upload', value: 0, color: '#8b5cf6' },
];

export default function CustomerStatisticsTab({ customerId, payments = [], invoices = [], tickets = [] }) {
  const totalDownload = dailyData.reduce((sum, d) => sum + d.download, 0);
  const totalUpload = dailyData.reduce((sum, d) => sum + d.upload, 0);
  const avgDaily = (totalDownload / dailyData.length).toFixed(2);
  const avgUpload = (totalUpload / dailyData.length).toFixed(2);

  const statCards = [
    {
      title: 'Avg Daily Download',
      value: `${avgDaily} GB`,
      icon: Download,
      color: 'blue',
    },
    {
      title: 'Avg Daily Upload',
      value: `${avgUpload} GB`,
      icon: Upload,
      color: 'purple',
    },
    {
      title: 'Total Payments',
      value: payments.length,
      icon: TrendingUp,
      color: 'emerald',
    },
    {
      title: 'Active Invoices',
      value: invoices.filter(i => i.status !== 'paid').length,
      icon: Zap,
      color: 'amber',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          const colorMap = {
            blue: 'bg-blue-50 text-blue-600',
            purple: 'bg-purple-50 text-purple-600',
            emerald: 'bg-emerald-50 text-emerald-600',
            amber: 'bg-amber-50 text-amber-600',
          };

          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
            >
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-slate-600 mb-1">{card.title}</p>
                      <p className="text-2xl font-bold text-slate-900">{card.value}</p>
                    </div>
                    <div className={`w-10 h-10 rounded-lg ${colorMap[card.color]} flex items-center justify-center`}>
                      <Icon className="w-5 h-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Data Usage Charts */}
      <Tabs defaultValue="daily" className="space-y-4">
        <TabsList className="bg-white border">
          <TabsTrigger value="daily">Daily Usage</TabsTrigger>
          <TabsTrigger value="weekly">Weekly Usage</TabsTrigger>
          <TabsTrigger value="monthly">Monthly Usage</TabsTrigger>
        </TabsList>

        {/* Daily Usage */}
        <TabsContent value="daily">
          <Card>
            <CardHeader>
              <CardTitle>Daily Data Usage</CardTitle>
              <CardDescription>Last 7 days of download and upload data</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis label={{ value: 'Data (GB)', angle: -90, position: 'insideLeft' }} />
                    <Tooltip formatter={(value) => `${value} GB`} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="download"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ fill: '#3b82f6' }}
                      name="Download"
                    />
                    <Line
                      type="monotone"
                      dataKey="upload"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      dot={{ fill: '#8b5cf6' }}
                      name="Upload"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Weekly Usage */}
        <TabsContent value="weekly">
          <Card>
            <CardHeader>
              <CardTitle>Weekly Data Usage</CardTitle>
              <CardDescription>Last 4 weeks of cumulative data</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" />
                    <YAxis label={{ value: 'Data (GB)', angle: -90, position: 'insideLeft' }} />
                    <Tooltip formatter={(value) => `${value} GB`} />
                    <Legend />
                    <Bar dataKey="download" fill="#3b82f6" name="Download" />
                    <Bar dataKey="upload" fill="#8b5cf6" name="Upload" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Monthly Usage */}
        <TabsContent value="monthly">
          <Card>
            <CardHeader>
              <CardTitle>Monthly Data Usage</CardTitle>
              <CardDescription>Last 2 months comparison</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis label={{ value: 'Data (GB)', angle: -90, position: 'insideLeft' }} />
                    <Tooltip formatter={(value) => `${value} GB`} />
                    <Legend />
                    <Bar dataKey="download" fill="#3b82f6" name="Download" />
                    <Bar dataKey="upload" fill="#8b5cf6" name="Upload" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Usage Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Usage Breakdown</CardTitle>
          <CardDescription>Download vs Upload ratio</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={usageBreakdown}
                  cx="50%"
                  cy="50%"
                  labelLine={true}
                  label={({ name, value }) => `${name}: ${value}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {usageBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `${value}%`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Usage Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">7-Day Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center pb-2 border-b">
              <span className="text-slate-600">Total Download</span>
              <span className="text-lg font-bold text-blue-600">{totalDownload.toFixed(1)} GB</span>
            </div>
            <div className="flex justify-between items-center pb-2 border-b">
              <span className="text-slate-600">Total Upload</span>
              <span className="text-lg font-bold text-purple-600">{totalUpload.toFixed(1)} GB</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600">Total Data Used</span>
              <span className="text-lg font-bold text-slate-900">{(totalDownload + totalUpload).toFixed(1)} GB</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Billing Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center pb-2 border-b">
              <span className="text-slate-600">Total Payments</span>
              <span className="text-lg font-bold">{payments.length}</span>
            </div>
            <div className="flex justify-between items-center pb-2 border-b">
              <span className="text-slate-600">Pending Invoices</span>
              <span className="text-lg font-bold text-amber-600">{invoices.filter(i => i.status !== 'paid').length}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600">Open Tickets</span>
              <span className="text-lg font-bold text-rose-600">{tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}