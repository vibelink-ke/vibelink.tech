import React, { useState } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle, CheckCircle, Info, Trash2, Eye, EyeOff, Filter, Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const NOTIFICATION_ICONS = {
  ticket_assigned: Info,
  ticket_updated: Info,
  outage_critical: AlertCircle,
  outage_resolved: CheckCircle,
  billing_reminder: Zap,
  payment_received: CheckCircle,
  customer_onboarded: CheckCircle,
  payment_failed: AlertCircle,
  sla_breach: AlertCircle,
  system_alert: AlertCircle,
};

const PRIORITY_COLORS = {
  low: 'bg-blue-100 text-blue-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
};

export default function NotificationCenter({ user, onClose }) {
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('recent');
  const queryClient = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications', user?.email],
    queryFn: () => vibelink.entities.Notification.filter(
      { recipient_email: user?.email },
      '-created_date',
      100
    ),
    enabled: !!user,
  });

  const markAsReadMutation = useMutation({
    mutationFn: ({ id, read }) =>
      vibelink.entities.Notification.update(id, {
        read,
        read_at: read ? new Date().toISOString() : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: (id) => vibelink.entities.Notification.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const unreadNotifications = notifications.filter(n => !n.read);
      for (const notif of unreadNotifications) {
        await vibelink.entities.Notification.update(notif.id, {
          read: true,
          read_at: new Date().toISOString(),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Filter notifications
  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread') return !n.read;
    if (filter === 'critical') return n.priority === 'critical';
    return true;
  });

  // Sort notifications
  const sortedNotifications = [...filteredNotifications].sort((a, b) => {
    if (sortBy === 'priority') {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return new Date(b.created_date) - new Date(a.created_date);
  });

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-white rounded-lg shadow-lg border border-slate-200">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-slate-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Notifications
              </h2>
              {unreadCount > 0 && (
                <p className="text-sm text-slate-600">
                  {unreadCount} unread
                </p>
              )}
            </div>
            {unreadCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => markAllAsReadMutation.mutate()}
                disabled={markAllAsReadMutation.isPending}
              >
                Mark all as read
              </Button>
            )}
          </div>

          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-48">
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="bg-white">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Notifications</SelectItem>
                  <SelectItem value="unread">Unread Only</SelectItem>
                  <SelectItem value="critical">Critical Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-48">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Most Recent</SelectItem>
                  <SelectItem value="priority">By Priority</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Notifications List */}
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="p-8 text-center text-slate-500">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
              <p className="mt-2">Loading notifications...</p>
            </div>
          ) : sortedNotifications.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No notifications</p>
            </div>
          ) : (
            <AnimatePresence>
              {sortedNotifications.map((notif, idx) => {
                const Icon = NOTIFICATION_ICONS[notif.type] || Info;
                return (
                  <motion.div
                    key={notif.id}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ delay: idx * 0.05 }}
                    className={`border-b border-slate-100 p-4 hover:bg-slate-50 transition-colors ${
                      !notif.read ? 'bg-indigo-50' : ''
                    }`}
                  >
                    <div className="flex gap-4">
                      {/* Icon */}
                      <div className="flex-shrink-0">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          notif.priority === 'critical'
                            ? 'bg-red-100'
                            : notif.priority === 'high'
                            ? 'bg-orange-100'
                            : 'bg-blue-100'
                        }`}>
                          <Icon className={`w-5 h-5 ${
                            notif.priority === 'critical'
                              ? 'text-red-600'
                              : notif.priority === 'high'
                              ? 'text-orange-600'
                              : 'text-blue-600'
                          }`} />
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h3 className="font-semibold text-slate-900 text-sm">
                            {notif.title}
                          </h3>
                          <Badge className={PRIORITY_COLORS[notif.priority]}>
                            {notif.priority}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-600 mb-2">
                          {notif.message}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDistanceToNow(new Date(notif.created_date), { addSuffix: true })}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 flex-shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            markAsReadMutation.mutate({ id: notif.id, read: !notif.read })
                          }
                          disabled={markAsReadMutation.isPending}
                          className="h-8 w-8 p-0"
                        >
                          {notif.read ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteNotificationMutation.mutate(notif.id)}
                          disabled={deleteNotificationMutation.isPending}
                          className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 p-4 flex justify-between">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {notifications.length > 0 && (
            <Button
              variant="outline"
              className="text-red-600"
              onClick={() => {
                // Delete all read notifications
                notifications
                  .filter(n => n.read)
                  .forEach(n => deleteNotificationMutation.mutate(n.id));
              }}
            >
              Clear Read
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}