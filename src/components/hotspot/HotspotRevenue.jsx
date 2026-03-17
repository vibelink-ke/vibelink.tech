import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, TrendingUp, Calendar, CreditCard, ArrowUpRight, ArrowDownRight, BarChart3, PieChart } from 'lucide-react';
import { motion } from 'framer-motion';

const revenueMetrics = [
  {
    title: 'Daily Revenue',
    amount: '$142.50',
    change: '+12.5%',
    trend: 'up',
    color: 'emerald'
  },
  {
    title: 'Weekly Revenue',
    amount: '$956.20',
    change: '+8.2%',
    trend: 'up',
    color: 'blue'
  },
  {
    title: 'Monthly Revenue',
    amount: '$4,285.50',
    change: '-2.4%',
    trend: 'down',
    color: 'indigo'
  }
];

export default function HotspotRevenue() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Revenue Analytics</h3>
          <p className="text-sm text-slate-500">Track and analyze your hotspot earnings</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-10">
            <Calendar className="w-4 h-4 mr-2" />
            Last 30 Days
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {revenueMetrics.map((metric, idx) => (
          <motion.div
            key={metric.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <Card className="border-none shadow-md overflow-hidden bg-white group hover:shadow-xl transition-all">
              <div className={`h-1 w-full bg-${metric.color}-500`} />
              <CardContent className="p-6">
                <div className="flex justify-between items-start">
                  <div className={`p-3 rounded-2xl bg-${metric.color}-50 text-${metric.color}-600`}>
                    <DollarSign className="w-6 h-6" />
                  </div>
                  <div className={`flex items-center gap-1 font-bold text-xs ${metric.trend === 'up' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {metric.trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                    {metric.change}
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">{metric.title}</p>
                  <h4 className="text-3xl font-black text-slate-900 mt-1">{metric.amount}</h4>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-none shadow-md bg-white">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-indigo-500" /> Revenue Growth
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex flex-col items-center justify-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400">
              <TrendingUp className="w-12 h-12 mb-2 opacity-20" />
              <p className="font-bold text-sm">Growth Trend Chart</p>
              <p className="text-xs">Visualization placeholder</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md bg-white">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <PieChart className="w-5 h-5 text-purple-500" /> Revenue Sources
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { name: 'Direct Vouchers', amount: '$2,840', percent: 65, color: 'bg-indigo-500' },
                { name: 'Online Payments', amount: '$1,250', percent: 28, color: 'bg-purple-500' },
                { name: 'Subscription Sync', amount: '$315', percent: 7, color: 'bg-slate-400' },
              ].map((source, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-bold text-slate-700">{source.name}</span>
                    <span className="font-black text-slate-900">{source.amount}</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${source.percent}%` }}
                      transition={{ duration: 1, delay: idx * 0.2 }}
                      className={`h-full ${source.color}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-md bg-white overflow-hidden">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100">
          <CardTitle className="text-lg flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-slate-600" /> Recent Transactions
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-slate-50">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Voucher Purchase - Daily Plan</p>
                    <p className="text-xs text-slate-500">Transaction ID: TXN-99283-X{i}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-slate-900">+$5.00</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">2 hours ago</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
        <div className="p-4 bg-slate-50/30 text-center">
          <button className="text-xs font-black text-indigo-600 hover:text-indigo-800 uppercase tracking-widest">
            View All Transactions
          </button>
        </div>
      </Card>
    </div>
  );
}

function Button({ children, variant = 'primary', className = '', ...props }) {
  const base = 'inline-flex items-center justify-center rounded-xl font-bold px-4 py-2 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2';
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-200 ring-indigo-500',
    outline: 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300'
  };
  
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
