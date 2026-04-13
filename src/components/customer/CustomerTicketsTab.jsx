import React from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import StatusBadge from '@/components/shared/StatusBadge';
import { format } from 'date-fns';

export default function CustomerTicketsTab({ customerId, tickets }) {
  const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;
  const resolvedTickets = tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length;

  const priorityColors = {
    low: 'bg-blue-100 text-blue-800',
    medium: 'bg-amber-100 text-amber-800',
    high: 'bg-orange-100 text-orange-800',
    urgent: 'bg-rose-100 text-rose-800',
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Total Tickets</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{tickets.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center">
                <Clock className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Open</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{openTickets}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Resolved</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{resolvedTickets}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-rose-50 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Urgent</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                  {tickets.filter(t => t.priority === 'urgent').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tickets List */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardHeader>
            <CardTitle>Support Tickets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {tickets.map((ticket, idx) => (
                <motion.div
                  key={ticket.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="p-4 border rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-slate-900 dark:text-slate-50">{ticket.subject}</p>
                        <Badge className={priorityColors[ticket.priority || 'medium']}>
                          {ticket.priority || 'medium'}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{ticket.description}</p>
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span>#{ticket.ticket_number}</span>
                        <span>{ticket.category}</span>
                        <span>{ticket.created_date ? format(new Date(ticket.created_date), 'MMM d, yyyy') : 'N/A'}</span>
                        {ticket.assigned_to_name && (
                          <span>Assigned to: {ticket.assigned_to_name}</span>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={ticket.status} />
                  </div>
                  {ticket.resolution && (
                    <div className="mt-3 p-3 bg-emerald-50 rounded-lg">
                      <p className="text-xs font-medium text-emerald-900 mb-1">Resolution:</p>
                      <p className="text-sm text-emerald-800">{ticket.resolution}</p>
                    </div>
                  )}
                </motion.div>
              ))}
              {tickets.length === 0 && (
                <div className="text-center py-12">
                  <MessageSquare className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500">No support tickets</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}