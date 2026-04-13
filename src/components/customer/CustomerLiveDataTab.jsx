import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wifi, Activity, Download, Upload, Monitor } from 'lucide-react';
import { format } from 'date-fns';

export default function CustomerLiveDataTab({ customer }) {
  const { data: sessions = [] } = useQuery({
    queryKey: ['customer-sessions', customer.id],
    queryFn: () => vibelink.entities.MikrotikSession.filter({ customer_id: customer.id }, '-created_date', 20),
    refetchInterval: 15000, // refresh every 15s
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ['customer-assignments', customer.id],
    queryFn: () => vibelink.entities.MikrotikCustomerAssignment.filter({ customer_id: customer.id }),
  });

  const activeSession = sessions.find(s => s.status === 'online');

  return (
    <div className="space-y-6">
      {/* Live Connection Status */}
      <Card className={`border-t-4 ${activeSession ? 'border-t-emerald-500' : 'border-t-slate-300'}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${activeSession ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
            Connection Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeSession ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 bg-emerald-50 rounded-lg">
                <p className="text-xs text-emerald-600 mb-1">Status</p>
                <Badge className="bg-emerald-100 text-emerald-800">Online</Badge>
              </div>
              <div className="p-3 bg-indigo-50 rounded-lg">
                <p className="text-xs text-indigo-600 mb-1">IP Address</p>
                <p className="font-mono text-sm font-medium">{activeSession.ip_address || customer.ip_address || 'N/A'}</p>
              </div>
              <div className="p-3 bg-purple-50 rounded-lg">
                <div className="flex items-center gap-1 mb-1"><Download className="w-3 h-3 text-purple-600" /><p className="text-xs text-purple-600">Downloaded</p></div>
                <p className="font-medium text-sm">{((activeSession.data_downloaded || 0) / (1024 * 1024)).toFixed(2)} MB</p>
              </div>
              <div className="p-3 bg-amber-50 rounded-lg">
                <div className="flex items-center gap-1 mb-1"><Upload className="w-3 h-3 text-amber-600" /><p className="text-xs text-amber-600">Uploaded</p></div>
                <p className="font-medium text-sm">{((activeSession.data_uploaded || 0) / (1024 * 1024)).toFixed(2)} MB</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <Wifi className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">Customer is currently offline</p>
              <p className="text-xs text-slate-400 mt-1">IP: {customer.ip_address || 'Not assigned'} • MAC: {customer.mac_address || 'Not assigned'}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Device Info */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Monitor className="w-5 h-5" />Device Information</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
              <p className="text-xs text-slate-500 mb-1">MAC Address</p>
              <p className="font-mono font-medium">{customer.mac_address || 'N/A'}</p>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
              <p className="text-xs text-slate-500 mb-1">IP Address</p>
              <p className="font-mono font-medium">{customer.ip_address || 'N/A'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Session History */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5" />Recent Sessions</CardTitle></CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-center text-slate-500 py-8">No session history available</p>
          ) : (
            <div className="space-y-2">
              {sessions.slice(0, 10).map((session) => (
                <div key={session.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${session.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-50">{session.status === 'online' ? 'Active Session' : 'Ended Session'}</p>
                      <p className="text-xs text-slate-500">
                        {session.created_date ? format(new Date(session.created_date), 'MMM d, yyyy HH:mm') : 'N/A'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>↓ {((session.data_downloaded || 0) / (1024 * 1024)).toFixed(1)} MB</p>
                    <p>↑ {((session.data_uploaded || 0) / (1024 * 1024)).toFixed(1)} MB</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}