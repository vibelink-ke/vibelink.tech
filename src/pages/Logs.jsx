import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { 
  FileText, 
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  RefreshCw,
  Shield,
  ChevronDown,
  ChevronRight,
  Download
} from 'lucide-react';
import { format, startOfDay, subDays } from 'date-fns';
import PageHeader from '@/components/shared/PageHeader';
import SearchInput from '@/components/shared/SearchInput';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';

const levelConfig = {
  info: { icon: Info, color: 'bg-blue-50 text-blue-700 border-blue-200' },
  warning: { icon: AlertTriangle, color: 'bg-amber-50 text-amber-700 border-amber-200' },
  error: { icon: AlertCircle, color: 'bg-rose-50 text-rose-700 border-rose-200' },
  debug: { icon: Bug, color: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const categoryColors = {
  auth: 'bg-purple-100 text-purple-700',
  billing: 'bg-emerald-100 text-emerald-700',
  customer: 'bg-blue-100 text-blue-700',
  payment: 'bg-green-100 text-green-700',
  sms: 'bg-pink-100 text-pink-700',
  email: 'bg-indigo-100 text-indigo-700',
  hotspot: 'bg-cyan-100 text-cyan-700',
  system: 'bg-slate-100 text-slate-700',
  api: 'bg-orange-100 text-orange-700',
  tenant: 'bg-violet-100 text-violet-700',
  service_plan: 'bg-teal-100 text-teal-700',
  invoice: 'bg-lime-100 text-lime-700',
  ticket: 'bg-yellow-100 text-yellow-700',
  settings: 'bg-gray-100 text-gray-700',
  user_management: 'bg-rose-100 text-rose-700',
};

const AUDIT_CATEGORIES = ['user_management', 'auth', 'settings', 'billing', 'customer', 'service_plan', 'invoice', 'payment', 'ticket'];
const DATE_RANGES = [
  { label: 'Today', value: '1' },
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
  { label: 'All time', value: 'all' },
];

export default function Logs() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-8 transition-colors duration-500">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader title="Logs & Audit Trail" subtitle="Monitor system activity and track user actions" />

        <Tabs defaultValue="audit">
          <TabsList className="bg-white border p-1">
            <TabsTrigger value="audit" className="gap-2">
              <Shield className="w-4 h-4" /> Audit Trail
            </TabsTrigger>
            <TabsTrigger value="system" className="gap-2">
              <FileText className="w-4 h-4" /> System Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="audit" className="mt-6">
            <AuditTrail />
          </TabsContent>

          <TabsContent value="system" className="mt-6">
            <SystemLogs />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function AuditTrail() {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState('all');
  const [dateRange, setDateRange] = useState('30');
  const [userFilter, setUserFilter] = useState('all');
  const [expandedLog, setExpandedLog] = useState(null);

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => vibelink.entities.SystemLog.list('-created_date', 500),
  });

  // Get unique users from logs
  const uniqueUsers = [...new Set(logs.map(l => l.user_email).filter(Boolean))];

  const filteredLogs = logs.filter(log => {
    const matchesSearch =
      log.action?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.user_email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.user_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.details?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.entity_name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || log.category === categoryFilter;
    const matchesLevel = levelFilter === 'all' || log.level === levelFilter;
    const matchesUser = userFilter === 'all' || log.user_email === userFilter;
    let matchesDate = true;
    if (dateRange !== 'all' && log.created_date) {
      const logDate = new Date(log.created_date);
      const cutoff = startOfDay(subDays(new Date(), parseInt(dateRange) - 1));
      matchesDate = logDate >= cutoff;
    }
    return matchesSearch && matchesCategory && matchesLevel && matchesUser && matchesDate;
  });

  const stats = {
    total: filteredLogs.length,
    warnings: filteredLogs.filter(l => l.level === 'warning').length,
    errors: filteredLogs.filter(l => l.level === 'error').length,
    users: new Set(filteredLogs.map(l => l.user_email).filter(Boolean)).size,
  };

  const exportCSV = () => {
    const headers = ['Date', 'Action', 'Category', 'Level', 'User', 'Details', 'Entity'];
    const rows = filteredLogs.map(l => [
      l.created_date ? format(new Date(l.created_date), 'yyyy-MM-dd HH:mm:ss') : '',
      l.action || '',
      l.category || '',
      l.level || '',
      l.user_email || '',
      (l.details || '').replace(/,/g, ';'),
      l.entity_name || '',
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-trail-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold text-slate-800">{stats.total}</p><p className="text-xs text-slate-500">Total Events</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold text-amber-600">{stats.warnings}</p><p className="text-xs text-slate-500">Warnings</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold text-rose-600">{stats.errors}</p><p className="text-xs text-slate-500">Errors</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold text-indigo-600">{stats.users}</p><p className="text-xs text-slate-500">Active Users</p></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search audit events..." />
        </div>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-36 bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DATE_RANGES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40 bg-white"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {AUDIT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace('_', ' ')}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-32 bg-white"><SelectValue placeholder="Level" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="w-44 bg-white"><SelectValue placeholder="User" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Users</SelectItem>
            {uniqueUsers.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={refetch} size="icon"><RefreshCw className="w-4 h-4" /></Button>
        <Button variant="outline" onClick={exportCSV} className="gap-2"><Download className="w-4 h-4" /> Export CSV</Button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">Loading audit trail...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <Shield className="w-12 h-12 mx-auto text-slate-300 mb-4" />
            <p>No audit events found</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="w-8"></TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Entity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLogs.map((log) => {
                const isExpanded = expandedLog === log.id;
                const LevelIcon = levelConfig[log.level]?.icon || Info;
                return (
                  <React.Fragment key={log.id}>
                    <TableRow
                      className={`cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-indigo-50/50' : ''}`}
                      onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                    >
                      <TableCell>
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                        {log.created_date ? format(new Date(log.created_date), 'MMM d, yyyy HH:mm:ss') : '-'}
                      </TableCell>
                      <TableCell className="font-medium text-slate-900">{log.action}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700">
                            {(log.user_name || log.user_email || 'S').charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm text-slate-600">{log.user_email || 'System'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${categoryColors[log.category] || 'bg-slate-100 text-slate-700'}`}>
                          {log.category?.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${levelConfig[log.level]?.color || 'bg-slate-100'}`}>
                          <LevelIcon className="w-3 h-3" />
                          {log.level}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">{log.entity_name || log.entity_type || '-'}</TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-indigo-50/30 p-0">
                          <div className="p-4 space-y-3">
                            {log.details && (
                              <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Details</p>
                                <p className="text-sm text-slate-700">{log.details}</p>
                              </div>
                            )}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                              {log.user_name && <div><span className="font-semibold text-slate-500">User:</span> <span className="text-slate-700">{log.user_name}</span></div>}
                              {log.user_role && <div><span className="font-semibold text-slate-500">Role:</span> <span className="text-slate-700">{log.user_role}</span></div>}
                              {log.entity_type && <div><span className="font-semibold text-slate-500">Entity Type:</span> <span className="text-slate-700">{log.entity_type}</span></div>}
                              {log.ip_address && <div><span className="font-semibold text-slate-500">IP:</span> <span className="text-slate-700">{log.ip_address}</span></div>}
                            </div>
                            {log.changes && (
                              <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Changes</p>
                                <div className="grid grid-cols-2 gap-3">
                                  {log.changes.before && (
                                    <div className="bg-rose-50 border border-rose-100 rounded-lg p-3">
                                      <p className="text-xs font-semibold text-rose-600 mb-1">Before</p>
                                      <pre className="text-xs text-slate-600 whitespace-pre-wrap">{JSON.stringify(log.changes.before, null, 2)}</pre>
                                    </div>
                                  )}
                                  {log.changes.after && (
                                    <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                                      <p className="text-xs font-semibold text-emerald-600 mb-1">After</p>
                                      <pre className="text-xs text-slate-600 whitespace-pre-wrap">{JSON.stringify(log.changes.after, null, 2)}</pre>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function SystemLogs() {
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ['system-logs'],
    queryFn: () => vibelink.entities.SystemLog.list('-created_date', 200),
  });

  const filteredLogs = logs.filter(log => {
    const matchesSearch =
      log.action?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.user_email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.details?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesLevel = levelFilter === 'all' || log.level === levelFilter;
    const matchesCategory = categoryFilter === 'all' || log.category === categoryFilter;
    return matchesSearch && matchesLevel && matchesCategory;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 max-w-md">
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search logs..." />
        </div>
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-full sm:w-36 bg-white"><SelectValue placeholder="Level" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="debug">Debug</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-44 bg-white"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="auth">Auth</SelectItem>
            <SelectItem value="billing">Billing</SelectItem>
            <SelectItem value="customer">Customer</SelectItem>
            <SelectItem value="payment">Payment</SelectItem>
            <SelectItem value="sms">SMS</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="hotspot">Hotspot</SelectItem>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="api">API</SelectItem>
            <SelectItem value="user_management">User Management</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => refetch()}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">Loading logs...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <FileText className="w-12 h-12 mx-auto text-slate-300 mb-4" />
            <p>No logs found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredLogs.map((log, index) => {
              const LevelIcon = levelConfig[log.level]?.icon || Info;
              return (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: index * 0.02 }}
                  className="p-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-lg ${levelConfig[log.level]?.color || 'bg-slate-100'}`}>
                      <LevelIcon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-900">{log.action}</span>
                        <Badge className={`text-xs ${categoryColors[log.category] || 'bg-slate-100'}`}>
                          {log.category}
                        </Badge>
                      </div>
                      {log.details && <p className="text-sm text-slate-600 mt-1 truncate">{log.details}</p>}
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                        <span>{log.user_email || 'System'}</span>
                        {log.ip_address && <span>{log.ip_address}</span>}
                        <span>{log.created_date ? format(new Date(log.created_date), 'MMM d, HH:mm:ss') : '-'}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}