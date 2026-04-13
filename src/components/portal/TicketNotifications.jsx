import React, { useState, useEffect } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, CheckCircle, Clock, AlertCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function TicketNotifications({ customerId }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!customerId) return;

    const unsubscribe = vibelink.entities.SupportTicket.subscribe((event) => {
      if (event.data.customer_id === customerId) {
        const notification = {
          id: `${event.type}-${event.id}-${Date.now()}`,
          type: event.type,
          ticket: event.data,
          timestamp: new Date(),
        };

        setNotifications(prev => [notification, ...prev].slice(0, 10));
        setUnreadCount(prev => prev + 1);

        // Show browser notification if supported
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Ticket Update', {
            body: getNotificationMessage(event.type, event.data),
            icon: '/favicon.ico',
          });
        }
      }
    });

    return unsubscribe;
  }, [customerId]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const getNotificationMessage = (type, ticket) => {
    switch (type) {
      case 'update':
        if (ticket.status === 'resolved') {
          return `Ticket ${ticket.ticket_number} has been resolved`;
        }
        if (ticket.status === 'in_progress') {
          return `Ticket ${ticket.ticket_number} is now in progress`;
        }
        return `Ticket ${ticket.ticket_number} has been updated`;
      case 'create':
        return `New ticket ${ticket.ticket_number} has been created`;
      default:
        return 'Ticket update';
    }
  };

  const getIcon = (type, ticket) => {
    if (ticket.status === 'resolved') return <CheckCircle className="w-4 h-4 text-emerald-500" />;
    if (ticket.status === 'in_progress') return <Clock className="w-4 h-4 text-amber-500" />;
    return <AlertCircle className="w-4 h-4 text-blue-500" />;
  };

  const clearNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const markAllRead = () => {
    setUnreadCount(0);
  };

  return (
    <DropdownMenu onOpenChange={(open) => open && markAllRead()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5 text-slate-500" />
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white text-xs rounded-full flex items-center justify-center font-medium"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </motion.span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="p-3 border-b">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50">Notifications</h3>
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNotifications([])}
                className="text-xs h-auto p-1"
              >
                Clear all
              </Button>
            )}
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <AnimatePresence>
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                <Bell className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                No new notifications
              </div>
            ) : (
              notifications.map((notification) => (
                <motion.div
                  key={notification.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="p-3 border-b hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {getIcon(notification.type, notification.ticket)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-50 mb-0.5">
                        {notification.ticket.ticket_number}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                        {getNotificationMessage(notification.type, notification.ticket)}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        {notification.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 -mt-1"
                      onClick={() => clearNotification(notification.id)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}