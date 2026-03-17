import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Send, MessageSquare, Mail, Phone } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function CustomerCommunicationTab({ customer }) {
  const [message, setMessage] = useState('');
  const [channel, setChannel] = useState('email');
  const queryClient = useQueryClient();

  const { data: messages = [] } = useQuery({
    queryKey: ['customer-messages', customer.id],
    queryFn: () => vibelink.entities.CustomerMessage.filter({ customer_id: customer.id }, '-created_date', 50),
  });

  const sendMutation = useMutation({
    mutationFn: async (data) => {
      return vibelink.entities.CustomerMessage.create({
        customer_id: customer.id,
        customer_name: customer.full_name,
        sender_type: 'staff',
        message: data.message,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['customer-messages', customer.id]);
      setMessage('');
      toast.success('Message sent');
    },
  });

  const handleSend = (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    sendMutation.mutate({ message, channel });
  };

  return (
    <div className="space-y-6">
      {/* Send Message */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            Send Message
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSend} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2 text-sm">
                <Mail className="w-4 h-4 text-slate-500" />
                <span className="text-slate-600">{customer.email}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-slate-500" />
                <span className="text-slate-600">{customer.phone}</span>
              </div>
              <div>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message here..."
                rows={4}
                required
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={sendMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700">
                <Send className="w-4 h-4 mr-2" />
                {sendMutation.isPending ? 'Sending...' : `Send via ${channel.toUpperCase()}`}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Message History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Message History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <p className="text-center text-slate-500 py-8">No messages yet</p>
          ) : (
            <div className="space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`p-3 rounded-lg ${msg.sender_type === 'staff' ? 'bg-indigo-50 ml-8' : 'bg-slate-50 mr-8'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-700">
                      {msg.sender_type === 'staff' ? 'Staff' : customer.full_name}
                    </span>
                    <span className="text-xs text-slate-400">
                      {msg.created_date ? format(new Date(msg.created_date), 'MMM d, HH:mm') : ''}
                    </span>
                  </div>
                  <p className="text-sm text-slate-800">{msg.message}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}