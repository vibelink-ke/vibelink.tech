import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Ticket, Search, Plus, Filter, Download, MoreVertical, CheckCircle, Clock, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';

const mockVouchers = [
  { id: '1', code: 'VIBE-782A', plan: 'Standard Hourly', status: 'available', expiry: '2026-04-16', created: '2026-03-15' },
  { id: '2', code: 'VIBE-913C', plan: 'Daily Unlimited', status: 'used', expiry: '2026-03-20', created: '2026-03-14' },
  { id: '3', code: 'VIBE-445D', plan: 'Standard Hourly', status: 'expired', expiry: '2026-03-10', created: '2026-03-01' },
  { id: '4', code: 'VIBE-221B', plan: 'Weekly Premium', status: 'available', expiry: '2026-05-01', created: '2026-03-15' },
  { id: '5', code: 'VIBE-667F', plan: 'Daily Unlimited', status: 'available', expiry: '2026-04-10', created: '2026-03-15' },
];

export default function HotspotVouchers() {
  const [searchQuery, setSearchQuery] = useState('');

  const getStatusInfo = (status) => {
    switch (status) {
      case 'available': return { color: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/20', icon: CheckCircle };
      case 'used': return { color: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20', icon: Clock };
      case 'expired': return { color: 'text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-900/20', icon: XCircle };
      default: return { color: 'text-slate-600 bg-slate-50 dark:text-slate-400 dark:bg-slate-800/50', icon: CheckCircle };
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Voucher Management</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Generate, track and manage access vouchers</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" className="flex-1 sm:flex-none">
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button className="flex-1 sm:flex-none">
            <Plus className="w-4 h-4 mr-2" />
            Generate Vouchers
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-none shadow-sm bg-gradient-to-br from-indigo-500 to-indigo-600 text-white dark:from-indigo-600 dark:to-indigo-700">
          <CardContent className="p-6">
            <p className="text-sm font-medium opacity-80">Total Available</p>
            <h4 className="text-3xl font-bold mt-1">1,248</h4>
            <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold bg-white/20 dark:bg-black/20 w-fit px-2 py-1 rounded-full text-white">
              <Plus className="w-3 h-3" /> 124 today
            </div>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm bg-white dark:bg-slate-900">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Redeemed This Month</p>
            <h4 className="text-3xl font-bold mt-1 dark:text-white">856</h4>
            <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 w-fit px-2 py-1 rounded-full">
              <CheckCircle className="w-3 h-3" /> +15.2%
            </div>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Expired Vouchers</p>
            <h4 className="text-3xl font-bold mt-1 text-rose-500 dark:text-rose-400">142</h4>
            <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 w-fit px-2 py-1 rounded-full">
              <Filter className="w-3 h-3" /> Cleanup Required
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-md overflow-hidden bg-white dark:bg-slate-900 transition-colors">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-4 justify-between items-center bg-slate-50/50 dark:bg-slate-850/50">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Search by code or plan..."
              className="w-full pl-10 pr-4 py-2 border-slate-200 dark:border-slate-800 rounded-xl text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none border transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <button className="flex-1 sm:flex-none px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 border rounded-xl transition-all shadow-sm">
              <Filter className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850/50 border-b border-slate-100 dark:border-slate-800 italic">
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Code</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Service Plan</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Created Date</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Expiry</th>
                <th className="px-6 py-4 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {mockVouchers.map((v, idx) => {
                const status = getStatusInfo(v.status);
                const StatusIcon = status.icon;
                return (
                  <motion.tr
                    key={v.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="group hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
                          <Ticket className="w-4 h-4" />
                        </div>
                        <span className="font-mono text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">{v.code}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300 font-medium">{v.plan}</td>
                    <td className="px-6 py-4">
                      <div className={`flex items-center w-fit gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${status.color}`}>
                        <StatusIcon className="w-3 h-3" />
                        {v.status}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">{v.created}</td>
                    <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">{v.expiry}</td>
                    <td className="px-6 py-4">
                      <button className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="p-4 bg-slate-50 dark:bg-slate-850/50 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center text-sm text-slate-500 dark:text-slate-400">
          <p>Showing 5 of 1,248 vouchers</p>
          <div className="flex gap-2">
            <button className="px-3 py-1 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-50 transition-colors" disabled>Previous</button>
            <button className="px-3 py-1 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">Next</button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Button({ children, variant = 'primary', className = '', ...props }) {
  const base = 'inline-flex items-center justify-center rounded-xl font-bold py-2.5 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2';
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-200 dark:shadow-none ring-indigo-500',
    outline: 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
  };
  
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
