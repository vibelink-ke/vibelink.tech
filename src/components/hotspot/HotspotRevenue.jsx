import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DollarSign, TrendingUp, Calendar } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';

export default function HotspotRevenue() {
  const [selectedHotspot, setSelectedHotspot] = useState('all');
  const [timeRange, setTimeRange] = useState('30');

  const { data: payments = [] } = useQuery({
    queryKey: ['hotspot-payments'],
    queryFn: () => vibelink.entities.Payment.list('-created_date', 500),
  });

  const { data: vouchers = [] } = useQuery({
    queryKey: ['vouchers'],
    queryFn: () => vibelink.entities.HotspotVoucher.list(),
  });

  const { data: hotspots = [] } = useQuery({
    queryKey: ['hotspots'],
    queryFn: () => vibelink.entities.Hotspot.list(),
  });

  const filteredPayments = useMemo(() => {
    let filtered = payments.filter(p => p.status === 'completed');
    
    const cutoffDate = subDays(new Date(), parseInt(timeRange));
    filtered = filtered.filter(p => p.created_date && new Date(p.created_date) >= cutoffDate);

    if (selectedHotspot !== 'all') {
      const hotspotVouchers = vouchers.filter(v => v.hotspot_id === selectedHotspot).map(v => v.code);
      filtered = filtered.filter(p => hotspotVouchers.includes(p.reference_number));
    }

    return filtered;
  }, [payments, selectedHotspot, timeRange, vouchers]);

  const totalRevenue = filteredPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const averageTransaction = filteredPayments.length > 0 ? totalRevenue / filteredPayments.length : 0;

  const dailyRevenue = useMemo(() => {
    const days = parseInt(timeRange);
    const data = [];
    
    for (let i = days - 1; i >= 0; i--) {
      const date = subDays(new Date(), i);
      const dayStart = startOfDay(date);
      const dayEnd = endOfDay(date);
      
      const dayPayments = filteredPayments.filter(p => {
        const pDate = new Date(p.created_date);
        return pDate >= dayStart && pDate <= dayEnd;
      });
      
      data.push({
        date: format(date, 'MMM d'),
        revenue: dayPayments.reduce((sum, p) => sum + (p.amount || 0), 0),
        transactions: dayPayments.length,
      });
    }
    
    return data;
  }, [filteredPayments, timeRange]);

  const revenueByHotspot = useMemo(() => {
    const hotspotRevenue = {};
    
    hotspots.forEach(h => {
      hotspotRevenue[h.id] = { name: h.name, revenue: 0, transactions: 0 };
    });

    vouchers.forEach(v => {
      const voucherPayments = payments.filter(p => 
        p.reference_number === v.code && p.status === 'completed'
      );
      const revenue = voucherPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
      
      if (v.hotspot_id && hotspotRevenue[v.hotspot_id]) {
        hotspotRevenue[v.hotspot_id].revenue += revenue;
        hotspotRevenue[v.hotspot_id].transactions += voucherPayments.length;
      }
    });

    return Object.values(hotspotRevenue).sort((a, b) => b.revenue - a.revenue);
  }, [hotspots, vouchers, payments]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Revenue Analytics</h3>
          <p className="text-sm text-slate-500">Track hotspot earnings and trends</p>
        </div>
        <div className="flex gap-3">
          <Select value={selectedHotspot} onValueChange={setSelectedHotspot}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Hotspots</SelectItem>
              {hotspots.map(h => (
                <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 Days</SelectItem>
              <SelectItem value="14">Last 14 Days</SelectItem>
              <SelectItem value="30">Last 30 Days</SelectItem>
              <SelectItem value="90">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500 mb-1">Total Revenue</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">KES {totalRevenue.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500 mb-1">Transactions</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{filteredPayments.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500 mb-1">Avg Transaction</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">KES {averageTransaction.toFixed(0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Revenue Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyRevenue}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={v => `KES ${v}`} />
                <Tooltip 
                  contentStyle={{ 
                    background: 'white', 
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                  }}
                  formatter={(value, name) => {
                    if (name === 'revenue') return [`KES ${value.toLocaleString()}`, 'Revenue'];
                    return [value, 'Transactions'];
                  }}
                />
                <Legend />
                <Area 
                  type="monotone" 
                  dataKey="revenue" 
                  stroke="#6366f1" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorRevenue)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Revenue by Hotspot */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue by Hotspot</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueByHotspot}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={v => `KES ${v}`} />
                <Tooltip 
                  contentStyle={{ 
                    background: 'white', 
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                  }}
                  formatter={(value, name) => {
                    if (name === 'revenue') return [`KES ${value.toLocaleString()}`, 'Revenue'];
                    return [value, 'Transactions'];
                  }}
                />
                <Legend />
                <Bar dataKey="revenue" fill="#6366f1" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}