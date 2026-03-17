import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion } from 'framer-motion';
import { 
  Activity, 
  Search, 
  Clock, 
  User, 
  AlertCircle,
  Info,
  AlertTriangle,
  Bug
} from 'lucide-react';
import moment from 'moment';

const levelIcons = {
  info: { icon: Info, color: 'text-blue-500 bg-blue-50' },
  warning: { icon: AlertTriangle, color: 'text-yellow-500 bg-yellow-50' },
  error: { icon: AlertCircle, color: 'text-red-500 bg-red-50' },
  debug: { icon: Bug, color: 'text-gray-500 bg-gray-50' }
};

const categoryColors = {
  auth: 'bg-purple-100 text-purple-800',
  billing: 'bg-green-100 text-green-800',
  customer: 'bg-blue-100 text-blue-800',
  payment: 'bg-emerald-100 text-emerald-800',
  invoice: 'bg-indigo-100 text-indigo-800',
  ticket: 'bg-orange-100 text-orange-800',
  system: 'bg-gray-100 text-gray-800',
  settings: 'bg-slate-100 text-slate-800',
  user_management: 'bg-pink-100 text-pink-800'
};

export default function ActivityLogViewer({ entityId = null, entityType = null }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState('all');

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['systemLogs', entityId, entityType],
    queryFn: async () => {
      if (entityId) {
        return vibelink.entities.SystemLog.filter({ entity_id: entityId }, '-created_date');
      }
      return vibelink.entities.SystemLog.list('-created_date', 100);
    }
  });

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      searchTerm === '' ||
      log.action?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.details?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.user_email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = categoryFilter === 'all' || log.category === categoryFilter;
    const matchesLevel = levelFilter === 'all' || log.level === levelFilter;
    
    return matchesSearch && matchesCategory && matchesLevel;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          Activity Log
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search activities..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="auth">Authentication</SelectItem>
              <SelectItem value="billing">Billing</SelectItem>
              <SelectItem value="customer">Customer</SelectItem>
              <SelectItem value="payment">Payment</SelectItem>
              <SelectItem value="invoice">Invoice</SelectItem>
              <SelectItem value="ticket">Ticket</SelectItem>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="settings">Settings</SelectItem>
              <SelectItem value="user_management">User Management</SelectItem>
            </SelectContent>
          </Select>
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="debug">Debug</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Activity List */}
        <div className="space-y-3 max-h-[600px] overflow-y-auto">
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading activity log...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No activities found</div>
          ) : (
            filteredLogs.map((log, idx) => {
              const LevelIcon = levelIcons[log.level]?.icon || Info;
              const levelColor = levelIcons[log.level]?.color || 'text-gray-500';
              
              return (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="border rounded-lg p-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${levelColor}`}>
                      <LevelIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-900">{log.action}</span>
                            <Badge className={categoryColors[log.category] || 'bg-gray-100 text-gray-800'}>
                              {log.category}
                            </Badge>
                            {log.entity_type && (
                              <Badge variant="outline" className="text-xs">
                                {log.entity_type}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-slate-600 mt-1">{log.details}</p>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-500 flex-shrink-0">
                          <Clock className="w-3 h-3" />
                          {moment(log.created_date).fromNow()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <User className="w-4 h-4" />
                        <span>{log.user_name}</span>
                        <span className="text-slate-400">•</span>
                        <span>{log.user_email}</span>
                        {log.user_role && (
                          <>
                            <span className="text-slate-400">•</span>
                            <Badge variant="outline" className="text-xs">{log.user_role}</Badge>
                          </>
                        )}
                      </div>
                      {log.entity_name && (
                        <div className="mt-2 text-sm text-slate-600">
                          <span className="font-medium">Entity:</span> {log.entity_name}
                        </div>
                      )}
                      {log.changes && (
                        <details className="mt-2">
                          <summary className="text-sm text-indigo-600 cursor-pointer hover:text-indigo-700">
                            View changes
                          </summary>
                          <div className="mt-2 p-3 bg-slate-50 rounded-lg text-xs">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="font-semibold text-slate-700 mb-1">Before:</div>
                                <pre className="text-slate-600 whitespace-pre-wrap">
                                  {JSON.stringify(log.changes.before, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <div className="font-semibold text-slate-700 mb-1">After:</div>
                                <pre className="text-slate-600 whitespace-pre-wrap">
                                  {JSON.stringify(log.changes.after, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}