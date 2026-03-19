import React, { useState, useEffect } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import NotificationCenter from './NotificationCenter';

export default function NotificationBell({ user }) {
  const [showCenter, setShowCenter] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user?.email) return;

    // Subscribe to notification changes
    const unsubscribe = vibelink.entities.Notification.subscribe((event) => {
      if (event.data.recipient_email === user.email) {
        // Update unread count
        vibelink.entities.Notification.filter(
          { recipient_email: user.email, read: false }
        ).then(notifications => {
          setUnreadCount(notifications.length);
        });
      }
    });

    // Initial load
    vibelink.entities.Notification.filter(
      { recipient_email: user.email, read: false }
    ).then(notifications => {
      setUnreadCount(notifications.length);
    });

    return unsubscribe;
  }, [user?.email]);

  return (
    <>
      {/* Bell Button */}
      <div className="relative">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowCenter(!showCenter)}
          className="relative rounded-full hover:bg-slate-100"
        >
          <Bell className="w-5 h-5 text-slate-700" />
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </motion.span>
          )}
        </Button>
      </div>

      {/* Notification Center Modal */}
      <AnimatePresence>
        {showCenter && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowCenter(false)}
            className="fixed inset-0 bg-black/50 z-40 flex items-start justify-end pt-20 pr-4"
          >
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[calc(100vh-5rem)] bg-white rounded-lg shadow-xl"
            >
              <NotificationCenter
                user={user}
                onClose={() => setShowCenter(false)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}