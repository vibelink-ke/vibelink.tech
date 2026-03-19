import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LayoutDashboard, Users, Zap, DollarSign, ArrowUpRight, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';

const stats = [
  {
    title: 'Total Hotspots',
    value: '24',
    icon: Zap,
    change: '+12%',
    color: 'from-indigo-500 to-indigo-600',
    chartColor: 'indigo'
  },
  {
    title: 'Active Sessions',
    value: '1,429',
    icon: Users,
    change: '+18%',
    color: 'from-blue-500 to-blue-600',
    chartColor: 'blue'
  },
  {
    title: 'Total Revenue',
    value: '$4,285.50',
    icon: DollarSign,
    change: '+7%',
    color: 'from-emerald-500 to-emerald-600',
    chartColor: 'emerald'
  },
  {
    title: 'Avg. Uptime',
    value: '99.98%',
    icon: LayoutDashboard,
    change: '+0.02%',
    color: 'from-purple-500 to-purple-600',
    chartColor: 'purple'
  }
];

export default function HotspotDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card className="overflow-hidden border-none shadow-md hover:shadow-xl transition-all duration-300 group dark:bg-slate-900">
              <div className={`h-1.5 bg-gradient-to-r ${stat.color}`} />
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-2.5 rounded-xl bg-gradient-to-br ${stat.color} text-white shadow-lg`}>
                    <stat.icon className="w-5 h-5" />
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                    <ArrowUpRight className="w-3 h-3" />
                    {stat.change}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">{stat.title}</p>
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {stat.value}
                  </h3>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-none shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg dark:text-white">Network Usage Trend</CardTitle>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Data consumption over the last 24 hours</p>
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-2 border-slate-200 dark:border-slate-800">
                <TrendingUp className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                View Detailed Analytics
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 group">
              <motion.div
                whileHover={{ scale: 1.1 }}
                className="p-4 rounded-full bg-slate-100 dark:bg-slate-800 mb-3 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/40 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors"
              >
                <TrendingUp className="w-8 h-8" />
              </motion.div>
              <p className="font-medium dark:text-slate-300">Analytics Chart Placeholder</p>
              <p className="text-sm dark:text-slate-400">Real-time data visualization will be rendered here</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-md dark:bg-slate-900">
          <CardHeader>
            <CardTitle className="text-lg dark:text-white">Recent Activities</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="p-4 flex items-start gap-4 hover:bg-slate-50 dark:hover:bg-slate-850/50 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-xs font-semibold">
                    {i}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">New session started</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                      <Users className="w-3 h-3" />
                      Client MAC: 00:1A:2B:3C:4D:5E
                    </p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 uppercase tracking-wider">2 minutes ago</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Internal Button component since we are recreating these as stubs and might not have access to all UI libs easily in a single file
function Button({ children, variant = 'primary', size = 'md', className = '', ...props }) {
  const base = 'inline-flex items-center justify-center rounded-lg font-medium transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-200 dark:shadow-none ring-indigo-500',
    outline: 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base'
  };
  
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  );
}
