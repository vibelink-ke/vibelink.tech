import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { Send, Loader2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

export default function CustomerMessaging({ customer }) {
  const [message, setMessage] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const messagesEndRef = useRef(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const loadUser = async () => {
      const user = await vibelink.auth.me();
      setCurrentUser(user);
    };
    loadUser();
  }, []);

  const { data: messages = [] } = useQuery({
    queryKey: ['customer-messages', customer.id],
    queryFn: () => vibelink.entities.CustomerMessage.filter({ customer_id: customer.id }, 'created_date'),
    enabled: !!customer?.id,
    refetchInterval: 5000,
  });

  const sendMutation = useMutation({
    mutationFn: (data) => vibelink.entities.CustomerMessage.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['customer-messages']);
      setMessage('');
    },
  });

  const markAsReadMutation = useMutation({
    mutationFn: ({ id }) => vibelink.entities.CustomerMessage.update(id, { 
      read: true, 
      read_at: new Date().toISOString() 
    }),
    onSuccess: () => queryClient.invalidateQueries(['customer-messages']),
  });

  // Mark unread customer messages as read
  useEffect(() => {
    const unreadCustomerMessages = messages.filter(
      m => m.sender_type === 'customer' && !m.read
    );
    unreadCustomerMessages.forEach(m => {
      markAsReadMutation.mutate({ id: m.id });
    });
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Real-time subscription
  useEffect(() => {
    if (!customer?.id) return;
    
    const unsubscribe = vibelink.entities.CustomerMessage.subscribe((event) => {
      if (event.data.customer_id === customer.id) {
        queryClient.invalidateQueries(['customer-messages']);
      }
    });

    return unsubscribe;
  }, [customer?.id, queryClient]);

  const handleSend = () => {
    if (!message.trim() || !currentUser) return;

    sendMutation.mutate({
      customer_id: customer.id,
      customer_name: customer.full_name,
      sender_type: 'staff',
      sender_name: currentUser.full_name,
      sender_email: currentUser.email,
      message: message.trim(),
      read: false,
    });
  };

  const unreadCount = messages.filter(m => m.sender_type === 'customer' && !m.read).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-slate-900 dark:text-slate-50 flex items-center gap-2">
          <MessageCircle className="w-4 h-4" />
          Messages ({messages.length})
        </h4>
        {unreadCount > 0 && (
          <Badge className="bg-rose-500">{unreadCount} unread</Badge>
        )}
      </div>

      <div className="border rounded-lg bg-white dark:bg-slate-900">
        <div className="h-80 overflow-y-auto p-4 space-y-3 bg-slate-50 dark:bg-slate-800/50">
          <AnimatePresence>
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <MessageCircle className="w-12 h-12 text-slate-300 mb-3" />
                <p className="text-slate-500 text-sm">No messages yet</p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`flex gap-3 ${msg.sender_type === 'staff' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.sender_type === 'customer' && (
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="bg-purple-100 text-purple-700 text-xs">
                        {msg.sender_name?.charAt(0).toUpperCase() || 'C'}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div className={`max-w-[70%]`}>
                    <div className={`rounded-2xl px-4 py-2 ${
                      msg.sender_type === 'staff' 
                        ? 'bg-indigo-600 text-white' 
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700'
                    }`}>
                      {msg.sender_type === 'customer' && (
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          {msg.sender_name || customer.full_name}
                        </p>
                      )}
                      <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 px-2">
                      {msg.created_date && format(new Date(msg.created_date), 'MMM d, HH:mm')}
                    </p>
                  </div>
                  {msg.sender_type === 'staff' && (
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="bg-indigo-100 text-indigo-700 text-xs">
                        {msg.sender_name?.charAt(0).toUpperCase() || 'S'}
                      </AvatarFallback>
                    </Avatar>
                  )}
                </motion.div>
              ))
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>

        <div className="p-3 border-t bg-white dark:bg-slate-900">
          <div className="flex gap-2">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type a message to customer..."
              rows={2}
              className="flex-1 resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button
              onClick={handleSend}
              disabled={!message.trim() || sendMutation.isPending}
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 h-auto"
            >
              {sendMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}