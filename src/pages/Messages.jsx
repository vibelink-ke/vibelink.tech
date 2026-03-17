import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { 
  Send,
  Mail,
  MessageSquare,
  Users,
  Clock,
  CheckCircle,
  User,
  Phone,
  XCircle
} from 'lucide-react';
import { format } from 'date-fns';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import EmptyState from '@/components/shared/EmptyState';
import SearchInput from '@/components/shared/SearchInput';
import StatCard from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { toast } from 'sonner';

const typeColors = {
  promotional: 'bg-purple-50 text-purple-700',
  service_update: 'bg-blue-50 text-blue-700',
  alert: 'bg-rose-50 text-rose-700',
  billing_reminder: 'bg-amber-50 text-amber-700',
  general: 'bg-slate-100 text-slate-700',
};

export default function Messages() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [activeTab, setActiveTab] = useState('bulk');
  const queryClient = useQueryClient();

  const { data: messages = [], isLoading: loadingMessages } = useQuery({
    queryKey: ['messages'],
    queryFn: () => vibelink.entities.Message.list('-created_date'),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => vibelink.entities.Customer.list(),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['plans'],
    queryFn: () => vibelink.entities.ServicePlan.list(),
  });

  const { data: smsLogs = [] } = useQuery({
    queryKey: ['smsLogs'],
    queryFn: () => vibelink.entities.SMSLog.list('-created_date', 50),
  });

  const { data: settings = [] } = useQuery({
    queryKey: ['settings'],
    queryFn: () => vibelink.entities.Setting.list(),
  });

  const { data: hotspots = [] } = useQuery({
    queryKey: ['hotspots'],
    queryFn: () => vibelink.entities.Hotspot.list(),
  });

  const { data: mikrotiks = [] } = useQuery({
    queryKey: ['mikrotiks'],
    queryFn: () => vibelink.entities.Mikrotik.list(),
  });

  const createMessageMutation = useMutation({
    mutationFn: async (data) => {
      let targetCustomers = [];
      if (data.target_audience === 'all') {
        targetCustomers = customers;
      } else if (data.target_audience === 'specific_plan') {
        targetCustomers = customers.filter(c => c.plan_id === data.target_plan_id);
      } else if (data.target_audience === 'by_router') {
        targetCustomers = customers.filter(c => c.mikrotik_id === data.target_router_id);
      } else if (data.target_audience === 'by_hotspot') {
        targetCustomers = customers.filter(c => c.hotspot_id === data.target_hotspot_id);
      } else if (data.target_audience === 'by_connection_type') {
        if (data.connection_type === 'pppoe') {
          targetCustomers = customers.filter(c => c.connection_type === 'pppoe');
        } else if (data.connection_type === 'hotspot') {
          targetCustomers = customers.filter(c => c.connection_type === 'hotspot');
        }
      } else {
        targetCustomers = customers.filter(c => c.status === data.target_audience);
      }
      
      if (data.channel === 'email' || data.channel === 'both') {
        for (const customer of targetCustomers) {
          if (customer.email) {
            await vibelink.integrations.Core.SendEmail({
              to: customer.email,
              subject: data.title,
              body: data.content,
            });
          }
        }
      }
      
      return vibelink.entities.Message.create({
        ...data,
        status: 'sent',
        sent_date: new Date().toISOString(),
        recipients_count: targetCustomers.length,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['messages']);
      setShowBulkForm(false);
    },
  });

  const sendSMSMutation = useMutation({
    mutationFn: async (data) => {
      const log = await vibelink.entities.SMSLog.create({
        recipient: data.recipient,
        message: data.message,
        customer_id: data.customer_id,
        customer_name: data.customer_name,
        gateway: settings.find(s => s.key === 'sms_gateway')?.value || 'hostpinnacle',
        status: 'sent',
      });
      return log;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['smsLogs']);
      toast.success('SMS sent successfully');
    },
  });

  const filteredMessages = messages.filter(msg => 
    msg.title?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalSent = messages.filter(m => m.status === 'sent').length;
  const totalRecipients = messages.reduce((sum, m) => sum + (m.recipients_count || 0), 0);
  const sentSMS = smsLogs.filter(l => l.status === 'sent' || l.status === 'delivered').length;
  const failedSMS = smsLogs.filter(l => l.status === 'failed').length;
  const smsEnabled = settings.find(s => s.key === 'sms_enabled')?.value === 'true';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Messaging & Notifications"
          subtitle="Send emails and SMS to customers"
          actionLabel="New Message"
          onAction={() => setShowBulkForm(true)}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white dark:bg-slate-800 border dark:border-slate-700 p-1">
            <TabsTrigger value="bulk" className="gap-2">
              <Mail className="w-4 h-4" /> Bulk Messages
            </TabsTrigger>
            <TabsTrigger value="sms" className="gap-2">
              <MessageSquare className="w-4 h-4" /> SMS
            </TabsTrigger>
          </TabsList>

          {/* BULK MESSAGES TAB */}
          <TabsContent value="bulk" className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-6 flex items-center gap-4">
                  <div className="p-3 bg-indigo-50 rounded-xl">
                    <Send className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-900">{totalSent}</p>
                    <p className="text-sm text-slate-500">Messages Sent</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 flex items-center gap-4">
                  <div className="p-3 bg-emerald-50 rounded-xl">
                    <Users className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-900">{totalRecipients}</p>
                    <p className="text-sm text-slate-500">Total Recipients</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 flex items-center gap-4">
                  <div className="p-3 bg-purple-50 rounded-xl">
                    <Mail className="w-6 h-6 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-900">{customers.filter(c => c.status === 'active').length}</p>
                    <p className="text-sm text-slate-500">Active Subscribers</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex-1 max-w-md">
              <SearchInput 
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search messages..."
              />
            </div>

            {loadingMessages ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-24 bg-white rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : filteredMessages.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No messages yet"
                description="Create your first bulk message to communicate with customers"
                actionLabel="New Message"
                onAction={() => setShowBulkForm(true)}
              />
            ) : (
              <div className="space-y-4">
                {filteredMessages.map((message, index) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Card className="hover:shadow-md transition-shadow">
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between">
                          <div className="space-y-2">
                            <div className="flex items-center gap-3">
                              <h3 className="font-semibold text-slate-900">{message.title}</h3>
                              <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${typeColors[message.type]}`}>
                                {message.type?.replace('_', ' ')}
                              </span>
                            </div>
                            <p className="text-slate-600 line-clamp-2">{message.content}</p>
                            <div className="flex items-center gap-4 text-sm text-slate-500">
                              <span className="flex items-center gap-1">
                                <Users className="w-4 h-4" />
                                {message.recipients_count || 0} recipients
                              </span>
                              <span className="flex items-center gap-1">
                                {message.channel === 'email' && <Mail className="w-4 h-4" />}
                                {message.channel === 'sms' && <MessageSquare className="w-4 h-4" />}
                                {message.channel === 'both' && <><Mail className="w-4 h-4" /><MessageSquare className="w-4 h-4" /></>}
                                {message.channel}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                {message.sent_date ? format(new Date(message.sent_date), 'MMM d, HH:mm') : '-'}
                              </span>
                            </div>
                          </div>
                          <StatusBadge status={message.status} />
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* SMS TAB */}
          <TabsContent value="sms" className="space-y-6">
            {!smsEnabled && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
                <MessageSquare className="w-5 h-5 text-amber-600" />
                <div>
                  <p className="font-medium text-amber-800">SMS Gateway Not Configured</p>
                  <p className="text-sm text-amber-600">Configure your SMS gateway in Settings to send messages.</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard title="Total Sent" value={smsLogs.length} icon={MessageSquare} />
              <StatCard title="Delivered" value={sentSMS} icon={CheckCircle} className="border-l-4 border-emerald-500" />
              <StatCard title="Failed" value={failedSMS} icon={XCircle} className="border-l-4 border-rose-500" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <SMSForm customers={customers} onSend={(data) => sendSMSMutation.mutate(data)} isLoading={sendSMSMutation.isPending} smsEnabled={smsEnabled} />

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    Recent Messages
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {smsLogs.length === 0 ? (
                      <p className="text-center text-slate-500 py-8">No messages sent yet</p>
                    ) : (
                      smsLogs.slice(0, 10).map((log, i) => (
                        <motion.div
                          key={log.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.05 }}
                          className="p-3 bg-slate-50 rounded-lg"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-medium text-slate-900">{log.recipient}</p>
                              {log.customer_name && (
                                <p className="text-sm text-slate-500">{log.customer_name}</p>
                              )}
                            </div>
                            <StatusBadge status={log.status} />
                          </div>
                          <p className="text-sm text-slate-600 mt-2 line-clamp-2">{log.message}</p>
                          <p className="text-xs text-slate-400 mt-2">
                            {log.created_date ? format(new Date(log.created_date), 'MMM d, HH:mm') : '-'}
                          </p>
                        </motion.div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <BulkMessageDialog
          open={showBulkForm}
          onOpenChange={setShowBulkForm}
          customers={customers}
          plans={plans}
          hotspots={hotspots}
          mikrotiks={mikrotiks}
          onSubmit={(data) => createMessageMutation.mutate(data)}
          isLoading={createMessageMutation.isPending}
        />
      </div>
    </div>
  );
}

function SMSForm({ customers, onSend, isLoading, smsEnabled }) {
  const [sendMode, setSendMode] = useState('single');
  const [formData, setFormData] = useState({
    recipient: '',
    customer_id: '',
    customer_name: '',
    message: '',
  });

  const templates = [
    { name: 'Payment Reminder', message: 'Dear Customer, your payment is due. Please pay to avoid service interruption.' },
    { name: 'Payment Received', message: 'Thank you! We have received your payment.' },
    { name: 'Service Suspended', message: 'Your internet service has been suspended due to non-payment.' },
    { name: 'Service Activated', message: 'Your internet service has been activated. Welcome!' },
  ];

  const handleCustomerSelect = (customerId) => {
    const customer = customers.find(c => c.id === customerId);
    if (customer) {
      setFormData({
        customer_id: customerId,
        recipient: customer.phone,
        customer_name: customer.full_name,
        message: formData.message,
      });
    }
  };

  const handleSend = () => {
    if (!formData.recipient || !formData.message) {
      toast.error('Please fill in all required fields');
      return;
    }
    onSend(formData);
    setFormData({ recipient: '', customer_id: '', customer_name: '', message: '' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="w-5 h-5" />
          Compose SMS
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={sendMode} onValueChange={setSendMode}>
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="single" className="gap-2"><User className="w-4 h-4" /> Single</TabsTrigger>
            <TabsTrigger value="customer" className="gap-2"><Users className="w-4 h-4" /> Customer</TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Phone Number *</Label>
              <Input
                value={formData.recipient}
                onChange={(e) => setFormData({...formData, recipient: e.target.value})}
                placeholder="+254712345678"
              />
            </div>
          </TabsContent>

          <TabsContent value="customer" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Select Customer *</Label>
              <Select value={formData.customer_id} onValueChange={handleCustomerSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name} - {c.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {formData.recipient && (
              <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
                <Phone className="w-4 h-4 text-slate-500" />
                <span className="text-sm text-slate-700">{formData.recipient}</span>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="space-y-2">
          <Label>Message Templates</Label>
          <div className="grid grid-cols-2 gap-2">
            {templates.map(t => (
              <Button
                key={t.name}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFormData({...formData, message: t.message})}
              >
                {t.name}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Message *</Label>
          <Textarea
            value={formData.message}
            onChange={(e) => setFormData({...formData, message: e.target.value})}
            placeholder="Type your message here..."
            rows={4}
          />
          <p className="text-xs text-slate-500">{formData.message.length}/160 characters</p>
        </div>

        <Button
          onClick={handleSend}
          disabled={isLoading || !smsEnabled}
          className="w-full bg-indigo-600 hover:bg-indigo-700"
        >
          <Send className="w-4 h-4 mr-2" />
          {isLoading ? 'Sending...' : 'Send SMS'}
        </Button>
      </CardContent>
    </Card>
  );
}

function BulkMessageDialog({ open, onOpenChange, customers, plans, hotspots, mikrotiks, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    type: 'general',
    target_audience: 'all',
    target_plan_id: '',
    target_router_id: '',
    target_hotspot_id: '',
    connection_type: '',
    channel: 'email',
  });

  const getRecipientCount = () => {
    if (formData.target_audience === 'all') {
      return customers.length;
    } else if (formData.target_audience === 'specific_plan') {
      return customers.filter(c => c.plan_id === formData.target_plan_id).length;
    } else if (formData.target_audience === 'by_router') {
      return customers.filter(c => c.mikrotik_id === formData.target_router_id).length;
    } else if (formData.target_audience === 'by_hotspot') {
      return customers.filter(c => c.hotspot_id === formData.target_hotspot_id).length;
    } else if (formData.target_audience === 'by_connection_type') {
      if (formData.connection_type === 'pppoe') {
        return customers.filter(c => c.connection_type === 'pppoe').length;
      } else if (formData.connection_type === 'hotspot') {
        return customers.filter(c => c.connection_type === 'hotspot').length;
      }
      return 0;
    } else {
      return customers.filter(c => c.status === formData.target_audience).length;
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  React.useEffect(() => {
    if (!open) {
      setFormData({
        title: '',
        content: '',
        type: 'general',
        target_audience: 'all',
        target_plan_id: '',
        target_router_id: '',
        target_hotspot_id: '',
        connection_type: '',
        channel: 'email',
      });
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Bulk Message</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>Title *</Label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              placeholder="Message title / Email subject"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Content *</Label>
            <Textarea
              value={formData.content}
              onChange={(e) => setFormData({...formData, content: e.target.value})}
              placeholder="Write your message here..."
              rows={5}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Message Type</Label>
              <Select value={formData.type} onValueChange={(v) => setFormData({...formData, type: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="promotional">Promotional</SelectItem>
                  <SelectItem value="service_update">Service Update</SelectItem>
                  <SelectItem value="alert">Alert</SelectItem>
                  <SelectItem value="billing_reminder">Billing Reminder</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Channel</Label>
              <Select value={formData.channel} onValueChange={(v) => setFormData({...formData, channel: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email Only</SelectItem>
                  <SelectItem value="sms">SMS Only</SelectItem>
                  <SelectItem value="both">Email & SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Target Audience</Label>
            <Select value={formData.target_audience} onValueChange={(v) => setFormData({...formData, target_audience: v, target_plan_id: '', target_router_id: '', target_hotspot_id: '', connection_type: ''})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                <SelectItem value="active">Active Customers Only</SelectItem>
                <SelectItem value="suspended">Suspended Customers</SelectItem>
                <SelectItem value="pending">Pending Customers</SelectItem>
                <SelectItem value="specific_plan">Specific Plan Subscribers</SelectItem>
                <SelectItem value="by_router">By Router/Location</SelectItem>
                <SelectItem value="by_hotspot">By Hotspot</SelectItem>
                <SelectItem value="by_connection_type">By Connection Type (PPPoE/Hotspot)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formData.target_audience === 'specific_plan' && (
            <div className="space-y-2">
              <Label>Select Plan</Label>
              <Select value={formData.target_plan_id} onValueChange={(v) => setFormData({...formData, target_plan_id: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map(plan => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {formData.target_audience === 'by_router' && (
            <div className="space-y-2">
              <Label>Select Router/Location</Label>
              <Select value={formData.target_router_id} onValueChange={(v) => setFormData({...formData, target_router_id: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a router" />
                </SelectTrigger>
                <SelectContent>
                  {mikrotiks.map(router => (
                    <SelectItem key={router.id} value={router.id}>
                      {router.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {formData.target_audience === 'by_hotspot' && (
            <div className="space-y-2">
              <Label>Select Hotspot</Label>
              <Select value={formData.target_hotspot_id} onValueChange={(v) => setFormData({...formData, target_hotspot_id: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a hotspot" />
                </SelectTrigger>
                <SelectContent>
                  {hotspots.map(hotspot => (
                    <SelectItem key={hotspot.id} value={hotspot.id}>
                      {hotspot.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {formData.target_audience === 'by_connection_type' && (
            <div className="space-y-2">
              <Label>Connection Type</Label>
              <Select value={formData.connection_type} onValueChange={(v) => setFormData({...formData, connection_type: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select connection type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pppoe">PPPoE (Fixed Line)</SelectItem>
                  <SelectItem value="hotspot">Hotspot (Wireless)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="bg-indigo-50 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 text-indigo-600" />
              <div>
                <p className="font-medium text-indigo-900">Target Recipients</p>
                <p className="text-sm text-indigo-600">{getRecipientCount()} customers will receive this message</p>
              </div>
            </div>
            <Send className="w-5 h-5 text-indigo-600" />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isLoading || getRecipientCount() === 0} 
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {isLoading ? 'Sending...' : 'Send Message'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}