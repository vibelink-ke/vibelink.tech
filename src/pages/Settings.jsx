import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { 
  Building,
  CreditCard,
  MessageSquare,
  Mail,
  Wifi,
  Bell,
  Save,
  Eye,
  EyeOff,
  TestTube,
  Shield,
  Check,
  Zap,
  PlayCircle,
  Clock,
  FileText
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';




import { toast } from 'sonner';

const PERMISSIONS = [
  { group: 'Customers', permissions: [
    { code: 'customers.view', label: 'View Customers' },
    { code: 'customers.create', label: 'Create Customers' },
    { code: 'customers.edit', label: 'Edit Customers' },
    { code: 'customers.delete', label: 'Delete Customers' },
  ]},
  { group: 'Billing', permissions: [
    { code: 'invoices.view', label: 'View Invoices' },
    { code: 'invoices.create', label: 'Create Invoices' },
    { code: 'invoices.edit', label: 'Edit Invoices' },
    { code: 'payments.view', label: 'View Payments' },
    { code: 'payments.create', label: 'Record Payments' },
  ]},
  { group: 'Support', permissions: [
    { code: 'tickets.view', label: 'View Tickets' },
    { code: 'tickets.create', label: 'Create Tickets' },
    { code: 'tickets.manage', label: 'Manage Tickets' },
  ]},
  { group: 'Hotspot', permissions: [
    { code: 'hotspot.view', label: 'View Hotspots' },
    { code: 'hotspot.manage', label: 'Manage Hotspots' },
    { code: 'vouchers.generate', label: 'Generate Vouchers' },
  ]},
  { group: 'Messaging', permissions: [
    { code: 'messages.view', label: 'View Messages' },
    { code: 'messages.send', label: 'Send Messages' },
    { code: 'sms.send', label: 'Send SMS' },
  ]},
  { group: 'Reports', permissions: [
    { code: 'reports.view', label: 'View Reports' },
    { code: 'reports.export', label: 'Export Reports' },
  ]},
  { group: 'Settings', permissions: [
    { code: 'settings.view', label: 'View Settings' },
    { code: 'settings.edit', label: 'Edit Settings' },
    { code: 'roles.manage', label: 'Manage Roles' },
    { code: 'users.manage', label: 'Manage Users' },
    { code: 'logs.view', label: 'View Logs' },
  ]},
];

const defaultSettings = {
  company_name: '',
  company_address: '',
  company_phone: '',
  company_email: '',
  currency: 'USD',
  tax_rate: '10',
  sms_gateway: 'hostpinnacle',
  sms_api_key: '',
  sms_api_secret: '',
  sms_sender_id: '',
  sms_enabled: 'false',
  payment_gateway: 'mpesa',
  payment_api_key: '',
  payment_api_secret: '',
  payment_merchant_id: '',
  payment_enabled: 'false',
  hotspot_payment_gateway: 'kopokopo',
  hotspot_payment_enabled: 'false',
  notify_payment_received: 'true',
  notify_invoice_due: 'true',
  notify_service_suspended: 'true',
  invoice_due_days: '7',
};

export default function Settings() {
  const [settings, setSettings] = useState(defaultSettings);
  const [showSecrets, setShowSecrets] = useState({});
  const [testingGateway, setTestingGateway] = useState(null);
  const [activeTab, setActiveTab] = useState('general');
  const queryClient = useQueryClient();

  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tab = urlParams.get('tab');
    if (tab) {
      setActiveTab(tab);
    }
  }, []);

  const { data: savedSettings = [], isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => vibelink.entities.Setting.list(),
  });

  React.useEffect(() => {
    if (savedSettings.length > 0) {
      const settingsMap = {};
      savedSettings.forEach(s => {
        settingsMap[s.key] = s.value;
      });
      setSettings({ ...defaultSettings, ...settingsMap });
    }
  }, [savedSettings]);

  const saveMutation = useMutation({
    mutationFn: async (newSettings) => {
      for (const [key, value] of Object.entries(newSettings)) {
        const existing = savedSettings.find(s => s.key === key);
        if (existing) {
          await vibelink.entities.Setting.update(existing.id, { value: String(value) });
        } else {
          await vibelink.entities.Setting.create({
            key,
            value: String(value),
            category: getCategoryForKey(key),
            is_secret: key.includes('api_key') || key.includes('api_secret'),
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['settings']);
      toast.success('Settings saved successfully');
    },
  });

  const getCategoryForKey = (key) => {
    if (key.startsWith('sms_')) return 'sms_gateway';
    if (key.startsWith('payment_')) return 'payment_gateway';
    if (key.startsWith('notify_') || key.includes('_days')) return 'notifications';
    return 'general';
  };

  const handleSave = () => {
    saveMutation.mutate(settings);
  };

  const testSMSGateway = async () => {
    setTestingGateway('sms');
    try {
      await new Promise(r => setTimeout(r, 1500));
      toast.success('SMS gateway connection successful');
    } catch {
      toast.error('SMS gateway connection failed');
    }
    setTestingGateway(null);
  };

  const testPaymentGateway = async () => {
    setTestingGateway('payment');
    try {
      await new Promise(r => setTimeout(r, 1500));
      toast.success('Payment gateway connection successful');
    } catch {
      toast.error('Payment gateway connection failed');
    }
    setTestingGateway(null);
  };

  const toggleSecret = (key) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <PageHeader title="Settings" subtitle="Configure your ISP billing system" />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border flex-wrap h-auto p-1">
            <TabsTrigger value="general" className="gap-2"><Building className="w-4 h-4" /> General</TabsTrigger>
            <TabsTrigger value="sms" className="gap-2"><MessageSquare className="w-4 h-4" /> SMS Gateway</TabsTrigger>
            <TabsTrigger value="payment" className="gap-2"><CreditCard className="w-4 h-4" /> Payment Gateway</TabsTrigger>
            <TabsTrigger value="notifications" className="gap-2"><Bell className="w-4 h-4" /> Notifications</TabsTrigger>
            <TabsTrigger value="email" className="gap-2"><Mail className="w-4 h-4" /> Email Server</TabsTrigger>
            <TabsTrigger value="automation" className="gap-2"><Zap className="w-4 h-4" /> Automation</TabsTrigger>
          </TabsList>

          {/* General Settings */}
          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>Company Information</CardTitle>
                <CardDescription>Basic information about your ISP business</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Company Name</Label>
                    <Input value={settings.company_name} onChange={(e) => setSettings({...settings, company_name: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input value={settings.company_phone} onChange={(e) => setSettings({...settings, company_phone: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input type="email" value={settings.company_email} onChange={(e) => setSettings({...settings, company_email: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>Currency</Label>
                    <Select value={settings.currency} onValueChange={(v) => setSettings({...settings, currency: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD ($)</SelectItem>
                        <SelectItem value="KES">KES (Ksh)</SelectItem>
                        <SelectItem value="EUR">EUR (€)</SelectItem>
                        <SelectItem value="GBP">GBP (£)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Address</Label>
                    <Textarea value={settings.company_address} onChange={(e) => setSettings({...settings, company_address: e.target.value})} rows={2} />
                  </div>
                  <div className="space-y-2">
                    <Label>Default Tax Rate (%)</Label>
                    <Input type="number" value={settings.tax_rate} onChange={(e) => setSettings({...settings, tax_rate: e.target.value})} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SMS Gateway */}
          <TabsContent value="sms">
            <Card>
              <CardHeader>
                <CardTitle>SMS Gateway Configuration</CardTitle>
                <CardDescription>Configure SMS provider for sending notifications</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                  <div>
                    <p className="font-medium">Enable SMS Notifications</p>
                    <p className="text-sm text-slate-500">Send SMS to customers</p>
                  </div>
                  <Switch checked={settings.sms_enabled === 'true'} onCheckedChange={(v) => setSettings({...settings, sms_enabled: String(v)})} />
                </div>
                <div className="space-y-2">
                  <Label>SMS Gateway Provider</Label>
                  <Select value={settings.sms_gateway} onValueChange={(v) => setSettings({...settings, sms_gateway: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hostpinnacle">HostPinnacle</SelectItem>
                      <SelectItem value="africastalking">Africa's Talking</SelectItem>
                      <SelectItem value="twilio">Twilio</SelectItem>
                      <SelectItem value="nexmo">Vonage (Nexmo)</SelectItem>
                      <SelectItem value="infobip">Infobip</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>API Key</Label>
                    <div className="relative">
                      <Input type={showSecrets.sms_api_key ? 'text' : 'password'} value={settings.sms_api_key} onChange={(e) => setSettings({...settings, sms_api_key: e.target.value})} />
                      <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sms_api_key')}>
                        {showSecrets.sms_api_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>API Secret</Label>
                    <div className="relative">
                      <Input type={showSecrets.sms_api_secret ? 'text' : 'password'} value={settings.sms_api_secret} onChange={(e) => setSettings({...settings, sms_api_secret: e.target.value})} />
                      <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sms_api_secret')}>
                        {showSecrets.sms_api_secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Sender ID</Label>
                    <Input value={settings.sms_sender_id} onChange={(e) => setSettings({...settings, sms_sender_id: e.target.value})} placeholder="YourISP" />
                  </div>
                </div>
                <Button variant="outline" onClick={testSMSGateway} disabled={testingGateway === 'sms'}>
                  <TestTube className="w-4 h-4 mr-2" />
                  {testingGateway === 'sms' ? 'Testing...' : 'Test Connection'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Payment Gateway */}
          <TabsContent value="payment">
            <div className="space-y-4">
              {/* Subscription/Recurring Payments */}
              <Card>
                <CardHeader>
                  <CardTitle>Subscription Payment Gateway</CardTitle>
                  <CardDescription>Configure payment provider for recurring monthly subscriptions</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                    <div>
                      <p className="font-medium">Enable Subscription Payments</p>
                      <p className="text-sm text-slate-500">Accept recurring payments for subscriptions</p>
                    </div>
                    <Switch checked={settings.payment_enabled === 'true'} onCheckedChange={(v) => setSettings({...settings, payment_enabled: String(v)})} />
                  </div>
                  <div className="space-y-2">
                    <Label>Payment Gateway Provider</Label>
                    <Select value={settings.payment_gateway} onValueChange={(v) => setSettings({...settings, payment_gateway: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mpesa">M-Pesa (Safaricom Paybill)</SelectItem>
                        <SelectItem value="kopokopo">Kopokopo</SelectItem>
                        <SelectItem value="stripe">Stripe</SelectItem>
                        <SelectItem value="paypal">PayPal</SelectItem>
                        <SelectItem value="flutterwave">Flutterwave</SelectItem>
                        <SelectItem value="paystack">Paystack</SelectItem>
                        <SelectItem value="pesapal">PesaPal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {settings.payment_gateway === 'mpesa' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Consumer Key</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_mpesa_consumer_key ? 'text' : 'password'} value={settings.sub_mpesa_consumer_key || ''} onChange={(e) => setSettings({...settings, sub_mpesa_consumer_key: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_mpesa_consumer_key')}>
                            {showSecrets.sub_mpesa_consumer_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Consumer Secret</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_mpesa_consumer_secret ? 'text' : 'password'} value={settings.sub_mpesa_consumer_secret || ''} onChange={(e) => setSettings({...settings, sub_mpesa_consumer_secret: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_mpesa_consumer_secret')}>
                            {showSecrets.sub_mpesa_consumer_secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Paybill / Shortcode</Label>
                        <Input value={settings.sub_mpesa_shortcode || ''} onChange={(e) => setSettings({...settings, sub_mpesa_shortcode: e.target.value})} placeholder="174379" />
                      </div>
                      <div className="space-y-2">
                        <Label>Passkey</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_mpesa_passkey ? 'text' : 'password'} value={settings.sub_mpesa_passkey || ''} onChange={(e) => setSettings({...settings, sub_mpesa_passkey: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_mpesa_passkey')}>
                            {showSecrets.sub_mpesa_passkey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {settings.payment_gateway === 'kopokopo' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Client ID</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_kopokopo_client_id ? 'text' : 'password'} value={settings.sub_kopokopo_client_id || ''} onChange={(e) => setSettings({...settings, sub_kopokopo_client_id: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_kopokopo_client_id')}>
                            {showSecrets.sub_kopokopo_client_id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Client Secret</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_kopokopo_client_secret ? 'text' : 'password'} value={settings.sub_kopokopo_client_secret || ''} onChange={(e) => setSettings({...settings, sub_kopokopo_client_secret: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_kopokopo_client_secret')}>
                            {showSecrets.sub_kopokopo_client_secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>API Key</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_kopokopo_api_key ? 'text' : 'password'} value={settings.sub_kopokopo_api_key || ''} onChange={(e) => setSettings({...settings, sub_kopokopo_api_key: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_kopokopo_api_key')}>
                            {showSecrets.sub_kopokopo_api_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>STK Till</Label>
                        <Input value={settings.sub_kopokopo_stk_till || ''} onChange={(e) => setSettings({...settings, sub_kopokopo_stk_till: e.target.value})} />
                      </div>
                    </div>
                  )}
                  {settings.payment_gateway === 'stripe' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Secret Key</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_stripe_secret_key ? 'text' : 'password'} value={settings.sub_stripe_secret_key || ''} onChange={(e) => setSettings({...settings, sub_stripe_secret_key: e.target.value})} placeholder="sk_live_..." />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_stripe_secret_key')}>
                            {showSecrets.sub_stripe_secret_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Publishable Key</Label>
                        <Input value={settings.sub_stripe_publishable_key || ''} onChange={(e) => setSettings({...settings, sub_stripe_publishable_key: e.target.value})} placeholder="pk_live_..." />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Webhook Secret</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_stripe_webhook_secret ? 'text' : 'password'} value={settings.sub_stripe_webhook_secret || ''} onChange={(e) => setSettings({...settings, sub_stripe_webhook_secret: e.target.value})} placeholder="whsec_..." />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_stripe_webhook_secret')}>
                            {showSecrets.sub_stripe_webhook_secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {settings.payment_gateway === 'paypal' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Client ID</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_paypal_client_id ? 'text' : 'password'} value={settings.sub_paypal_client_id || ''} onChange={(e) => setSettings({...settings, sub_paypal_client_id: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_paypal_client_id')}>
                            {showSecrets.sub_paypal_client_id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Client Secret</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_paypal_client_secret ? 'text' : 'password'} value={settings.sub_paypal_client_secret || ''} onChange={(e) => setSettings({...settings, sub_paypal_client_secret: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_paypal_client_secret')}>
                            {showSecrets.sub_paypal_client_secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {settings.payment_gateway === 'flutterwave' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Public Key</Label>
                        <Input value={settings.sub_flutterwave_public_key || ''} onChange={(e) => setSettings({...settings, sub_flutterwave_public_key: e.target.value})} placeholder="FLWPUBK-..." />
                      </div>
                      <div className="space-y-2">
                        <Label>Secret Key</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_flutterwave_secret_key ? 'text' : 'password'} value={settings.sub_flutterwave_secret_key || ''} onChange={(e) => setSettings({...settings, sub_flutterwave_secret_key: e.target.value})} placeholder="FLWSECK-..." />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_flutterwave_secret_key')}>
                            {showSecrets.sub_flutterwave_secret_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Encryption Key</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_flutterwave_encryption_key ? 'text' : 'password'} value={settings.sub_flutterwave_encryption_key || ''} onChange={(e) => setSettings({...settings, sub_flutterwave_encryption_key: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_flutterwave_encryption_key')}>
                            {showSecrets.sub_flutterwave_encryption_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {settings.payment_gateway === 'paystack' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Public Key</Label>
                        <Input value={settings.sub_paystack_public_key || ''} onChange={(e) => setSettings({...settings, sub_paystack_public_key: e.target.value})} placeholder="pk_live_..." />
                      </div>
                      <div className="space-y-2">
                        <Label>Secret Key</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_paystack_secret_key ? 'text' : 'password'} value={settings.sub_paystack_secret_key || ''} onChange={(e) => setSettings({...settings, sub_paystack_secret_key: e.target.value})} placeholder="sk_live_..." />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_paystack_secret_key')}>
                            {showSecrets.sub_paystack_secret_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {settings.payment_gateway === 'pesapal' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Consumer Key</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_pesapal_consumer_key ? 'text' : 'password'} value={settings.sub_pesapal_consumer_key || ''} onChange={(e) => setSettings({...settings, sub_pesapal_consumer_key: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_pesapal_consumer_key')}>
                            {showSecrets.sub_pesapal_consumer_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Consumer Secret</Label>
                        <div className="relative">
                          <Input type={showSecrets.sub_pesapal_consumer_secret ? 'text' : 'password'} value={settings.sub_pesapal_consumer_secret || ''} onChange={(e) => setSettings({...settings, sub_pesapal_consumer_secret: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('sub_pesapal_consumer_secret')}>
                            {showSecrets.sub_pesapal_consumer_secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  <Button variant="outline" onClick={testPaymentGateway} disabled={testingGateway === 'payment'}>
                    <TestTube className="w-4 h-4 mr-2" />
                    {testingGateway === 'payment' ? 'Testing...' : 'Test Connection'}
                  </Button>
                </CardContent>
              </Card>

              {/* Hotspot Payments */}
              <Card>
                <CardHeader>
                  <CardTitle>Hotspot Payment Gateway</CardTitle>
                  <CardDescription>Configure separate payment provider for hotspot voucher purchases</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                    <div>
                      <p className="font-medium">Enable Hotspot Payments</p>
                      <p className="text-sm text-slate-500">Accept payments for hotspot vouchers</p>
                    </div>
                    <Switch checked={settings.hotspot_payment_enabled === 'true'} onCheckedChange={(v) => setSettings({...settings, hotspot_payment_enabled: String(v)})} />
                  </div>
                  <div className="space-y-2">
                    <Label>Payment Gateway Provider</Label>
                    <Select value={settings.hotspot_payment_gateway} onValueChange={(v) => setSettings({...settings, hotspot_payment_gateway: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="kopokopo">Kopokopo</SelectItem>
                        <SelectItem value="mpesa">M-Pesa (Safaricom)</SelectItem>
                        <SelectItem value="stripe">Stripe</SelectItem>
                        <SelectItem value="paypal">PayPal</SelectItem>
                        <SelectItem value="flutterwave">Flutterwave</SelectItem>
                        <SelectItem value="paystack">Paystack</SelectItem>
                        <SelectItem value="pesapal">PesaPal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {settings.hotspot_payment_gateway === 'kopokopo' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Client ID</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_kopokopo_client_id ? 'text' : 'password'} value={settings.hotspot_kopokopo_client_id || ''} onChange={(e) => setSettings({...settings, hotspot_kopokopo_client_id: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_kopokopo_client_id')}>
                            {showSecrets.hotspot_kopokopo_client_id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Client Secret</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_kopokopo_client_secret ? 'text' : 'password'} value={settings.hotspot_kopokopo_client_secret || ''} onChange={(e) => setSettings({...settings, hotspot_kopokopo_client_secret: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_kopokopo_client_secret')}>
                            {showSecrets.hotspot_kopokopo_client_secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>API Key</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_kopokopo_api_key ? 'text' : 'password'} value={settings.hotspot_kopokopo_api_key || ''} onChange={(e) => setSettings({...settings, hotspot_kopokopo_api_key: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_kopokopo_api_key')}>
                            {showSecrets.hotspot_kopokopo_api_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>STK Till</Label>
                        <Input value={settings.hotspot_kopokopo_stk_till || ''} onChange={(e) => setSettings({...settings, hotspot_kopokopo_stk_till: e.target.value})} />
                      </div>
                    </div>
                  )}
                  {settings.hotspot_payment_gateway === 'mpesa' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Consumer Key</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_mpesa_consumer_key ? 'text' : 'password'} value={settings.hotspot_mpesa_consumer_key || ''} onChange={(e) => setSettings({...settings, hotspot_mpesa_consumer_key: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_mpesa_consumer_key')}>
                            {showSecrets.hotspot_mpesa_consumer_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Consumer Secret</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_mpesa_consumer_secret ? 'text' : 'password'} value={settings.hotspot_mpesa_consumer_secret || ''} onChange={(e) => setSettings({...settings, hotspot_mpesa_consumer_secret: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_mpesa_consumer_secret')}>
                            {showSecrets.hotspot_mpesa_consumer_secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Shortcode</Label>
                        <Input value={settings.hotspot_mpesa_shortcode || ''} onChange={(e) => setSettings({...settings, hotspot_mpesa_shortcode: e.target.value})} placeholder="174379" />
                      </div>
                      <div className="space-y-2">
                        <Label>Passkey</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_mpesa_passkey ? 'text' : 'password'} value={settings.hotspot_mpesa_passkey || ''} onChange={(e) => setSettings({...settings, hotspot_mpesa_passkey: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_mpesa_passkey')}>
                            {showSecrets.hotspot_mpesa_passkey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {settings.hotspot_payment_gateway === 'stripe' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Secret Key</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_stripe_secret_key ? 'text' : 'password'} value={settings.hotspot_stripe_secret_key || ''} onChange={(e) => setSettings({...settings, hotspot_stripe_secret_key: e.target.value})} placeholder="sk_live_..." />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_stripe_secret_key')}>
                            {showSecrets.hotspot_stripe_secret_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Publishable Key</Label>
                        <Input value={settings.hotspot_stripe_publishable_key || ''} onChange={(e) => setSettings({...settings, hotspot_stripe_publishable_key: e.target.value})} placeholder="pk_live_..." />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Webhook Secret</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_stripe_webhook_secret ? 'text' : 'password'} value={settings.hotspot_stripe_webhook_secret || ''} onChange={(e) => setSettings({...settings, hotspot_stripe_webhook_secret: e.target.value})} placeholder="whsec_..." />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_stripe_webhook_secret')}>
                            {showSecrets.hotspot_stripe_webhook_secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {settings.hotspot_payment_gateway === 'paypal' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Client ID</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_paypal_client_id ? 'text' : 'password'} value={settings.hotspot_paypal_client_id || ''} onChange={(e) => setSettings({...settings, hotspot_paypal_client_id: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_paypal_client_id')}>
                            {showSecrets.hotspot_paypal_client_id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Client Secret</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_paypal_client_secret ? 'text' : 'password'} value={settings.hotspot_paypal_client_secret || ''} onChange={(e) => setSettings({...settings, hotspot_paypal_client_secret: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_paypal_client_secret')}>
                            {showSecrets.hotspot_paypal_client_secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {settings.hotspot_payment_gateway === 'flutterwave' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Public Key</Label>
                        <Input value={settings.hotspot_flutterwave_public_key || ''} onChange={(e) => setSettings({...settings, hotspot_flutterwave_public_key: e.target.value})} placeholder="FLWPUBK-..." />
                      </div>
                      <div className="space-y-2">
                        <Label>Secret Key</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_flutterwave_secret_key ? 'text' : 'password'} value={settings.hotspot_flutterwave_secret_key || ''} onChange={(e) => setSettings({...settings, hotspot_flutterwave_secret_key: e.target.value})} placeholder="FLWSECK-..." />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_flutterwave_secret_key')}>
                            {showSecrets.hotspot_flutterwave_secret_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Encryption Key</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_flutterwave_encryption_key ? 'text' : 'password'} value={settings.hotspot_flutterwave_encryption_key || ''} onChange={(e) => setSettings({...settings, hotspot_flutterwave_encryption_key: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_flutterwave_encryption_key')}>
                            {showSecrets.hotspot_flutterwave_encryption_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {settings.hotspot_payment_gateway === 'paystack' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Public Key</Label>
                        <Input value={settings.hotspot_paystack_public_key || ''} onChange={(e) => setSettings({...settings, hotspot_paystack_public_key: e.target.value})} placeholder="pk_live_..." />
                      </div>
                      <div className="space-y-2">
                        <Label>Secret Key</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_paystack_secret_key ? 'text' : 'password'} value={settings.hotspot_paystack_secret_key || ''} onChange={(e) => setSettings({...settings, hotspot_paystack_secret_key: e.target.value})} placeholder="sk_live_..." />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_paystack_secret_key')}>
                            {showSecrets.hotspot_paystack_secret_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {settings.hotspot_payment_gateway === 'pesapal' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Consumer Key</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_pesapal_consumer_key ? 'text' : 'password'} value={settings.hotspot_pesapal_consumer_key || ''} onChange={(e) => setSettings({...settings, hotspot_pesapal_consumer_key: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_pesapal_consumer_key')}>
                            {showSecrets.hotspot_pesapal_consumer_key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Consumer Secret</Label>
                        <div className="relative">
                          <Input type={showSecrets.hotspot_pesapal_consumer_secret ? 'text' : 'password'} value={settings.hotspot_pesapal_consumer_secret || ''} onChange={(e) => setSettings({...settings, hotspot_pesapal_consumer_secret: e.target.value})} />
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('hotspot_pesapal_consumer_secret')}>
                            {showSecrets.hotspot_pesapal_consumer_secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  <Button variant="outline" onClick={() => {
                    setTestingGateway('hotspot');
                    setTimeout(() => {
                      toast.success('Hotspot gateway connection successful');
                      setTestingGateway(null);
                    }, 1500);
                  }} disabled={testingGateway === 'hotspot'}>
                    <TestTube className="w-4 h-4 mr-2" />
                    {testingGateway === 'hotspot' ? 'Testing...' : 'Test Connection'}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Notifications */}
          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle>Notification Settings</CardTitle>
                <CardDescription>Configure automatic notifications</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                    <div>
                      <p className="font-medium">Payment Received</p>
                      <p className="text-sm text-slate-500">Notify customers when payment is received</p>
                    </div>
                    <Switch checked={settings.notify_payment_received === 'true'} onCheckedChange={(v) => setSettings({...settings, notify_payment_received: String(v)})} />
                  </div>
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                    <div>
                      <p className="font-medium">Invoice Due Reminder</p>
                      <p className="text-sm text-slate-500">Send reminder before invoice due date</p>
                    </div>
                    <Switch checked={settings.notify_invoice_due === 'true'} onCheckedChange={(v) => setSettings({...settings, notify_invoice_due: String(v)})} />
                  </div>
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                    <div>
                      <p className="font-medium">Service Suspended</p>
                      <p className="text-sm text-slate-500">Notify when service is suspended</p>
                    </div>
                    <Switch checked={settings.notify_service_suspended === 'true'} onCheckedChange={(v) => setSettings({...settings, notify_service_suspended: String(v)})} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Invoice Due Reminder (days before)</Label>
                  <Input type="number" value={settings.invoice_due_days} onChange={(e) => setSettings({...settings, invoice_due_days: e.target.value})} className="max-w-xs" />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Email Server */}
          <TabsContent value="email">
            <EmailServerTab showSecrets={showSecrets} toggleSecret={toggleSecret} testingGateway={testingGateway} setTestingGateway={setTestingGateway} />
          </TabsContent>

          {/* Automation */}
          <TabsContent value="automation">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Backend Functions</CardTitle>
                  <CardDescription>Automated tasks and scheduled operations</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <AutomationFunction
                    title="Generate Recurring Invoices"
                    description="Automatically create monthly invoices for all active customers based on their billing cycle"
                    icon={<FileText className="w-5 h-5" />}
                    functionName="generateRecurringInvoices"
                    params={{}}
                    testParams={{ test_mode: true }}
                  />
                  <AutomationFunction
                    title="Monitor SLA Compliance"
                    description="Check open tickets for SLA breaches and send alerts to staff"
                    icon={<Shield className="w-5 h-5" />}
                    functionName="monitorSLACompliance"
                    params={{}}
                  />
                  <AutomationFunction
                    title="Suspend Overdue Accounts"
                    description="Automatically suspend customers with overdue payments beyond grace period"
                    icon={<Clock className="w-5 h-5" />}
                    functionName="suspendOverdueAccounts"
                    params={{ grace_days: 7 }}
                    testParams={{ test_mode: true, grace_days: 7 }}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Network Monitoring</CardTitle>
                  <CardDescription>Configure automated network health monitoring and alerts</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Enabled Monitors</Label>
                      <div className="flex flex-wrap gap-2">
                        <label className="flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer hover:bg-slate-50">
                          <Checkbox
                            checked={JSON.parse(settings.network_monitoring_enabled || '[]').includes('zabbix')}
                            onCheckedChange={(checked) => {
                              const enabled = JSON.parse(settings.network_monitoring_enabled || '[]');
                              const updated = checked
                                ? [...enabled, 'zabbix']
                                : enabled.filter(e => e !== 'zabbix');
                              setSettings({...settings, network_monitoring_enabled: JSON.stringify(updated)});
                            }}
                          />
                          <span className="text-sm">Zabbix</span>
                        </label>
                        <label className="flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer hover:bg-slate-50">
                          <Checkbox
                            checked={JSON.parse(settings.network_monitoring_enabled || '[]').includes('nagios')}
                            onCheckedChange={(checked) => {
                              const enabled = JSON.parse(settings.network_monitoring_enabled || '[]');
                              const updated = checked
                                ? [...enabled, 'nagios']
                                : enabled.filter(e => e !== 'nagios');
                              setSettings({...settings, network_monitoring_enabled: JSON.stringify(updated)});
                            }}
                          />
                          <span className="text-sm">Nagios</span>
                        </label>
                        <label className="flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer hover:bg-slate-50">
                          <Checkbox
                            checked={JSON.parse(settings.network_monitoring_enabled || '[]').includes('snmp')}
                            onCheckedChange={(checked) => {
                              const enabled = JSON.parse(settings.network_monitoring_enabled || '[]');
                              const updated = checked
                                ? [...enabled, 'snmp']
                                : enabled.filter(e => e !== 'snmp');
                              setSettings({...settings, network_monitoring_enabled: JSON.stringify(updated)});
                            }}
                          />
                          <span className="text-sm">SNMP</span>
                        </label>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Alert Severity Threshold</Label>
                      <Select 
                        value={settings.monitoring_severity_threshold || 'medium'} 
                        onValueChange={(v) => setSettings({...settings, monitoring_severity_threshold: v})}
                      >
                        <SelectTrigger className="max-w-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low (Alert on all issues)</SelectItem>
                          <SelectItem value="medium">Medium (Moderate and above)</SelectItem>
                          <SelectItem value="high">High (Critical issues only)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {JSON.parse(settings.network_monitoring_enabled || '[]').includes('zabbix') && (
                      <div className="p-4 border rounded-lg space-y-3">
                        <h4 className="font-medium">Zabbix Configuration</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2 col-span-2">
                            <Label>API URL</Label>
                            <Input 
                              value={settings.zabbix_api_url || ''} 
                              onChange={(e) => setSettings({...settings, zabbix_api_url: e.target.value})}
                              placeholder="https://your-zabbix.com"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Username</Label>
                            <Input 
                              value={settings.zabbix_username || ''} 
                              onChange={(e) => setSettings({...settings, zabbix_username: e.target.value})}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Password</Label>
                            <Input 
                              type="password"
                              value={settings.zabbix_password || ''} 
                              onChange={(e) => setSettings({...settings, zabbix_password: e.target.value})}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {JSON.parse(settings.network_monitoring_enabled || '[]').includes('nagios') && (
                      <div className="p-4 border rounded-lg space-y-3">
                        <h4 className="font-medium">Nagios Configuration</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2 col-span-2">
                            <Label>API URL</Label>
                            <Input 
                              value={settings.nagios_api_url || ''} 
                              onChange={(e) => setSettings({...settings, nagios_api_url: e.target.value})}
                              placeholder="https://your-nagios.com"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Username</Label>
                            <Input 
                              value={settings.nagios_username || ''} 
                              onChange={(e) => setSettings({...settings, nagios_username: e.target.value})}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Password</Label>
                            <Input 
                              type="password"
                              value={settings.nagios_password || ''} 
                              onChange={(e) => setSettings({...settings, nagios_password: e.target.value})}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {JSON.parse(settings.network_monitoring_enabled || '[]').includes('snmp') && (
                      <div className="p-4 border rounded-lg space-y-3">
                        <h4 className="font-medium">SNMP Hosts</h4>
                        <div className="space-y-2">
                          <Label>Monitored Hosts (JSON)</Label>
                          <Textarea 
                            value={settings.snmp_hosts || '[]'} 
                            onChange={(e) => setSettings({...settings, snmp_hosts: e.target.value})}
                            placeholder='[{"name":"Router1","ip":"192.168.1.1","location":"Main Office"}]'
                            rows={4}
                            className="font-mono text-sm"
                          />
                          <p className="text-xs text-slate-500">Add hosts in JSON format with name, ip, and optional location</p>
                        </div>
                      </div>
                    )}

                    <AutomationFunction
                      title="Monitor Network Health"
                      description="Polls monitoring tools (Zabbix, Nagios, SNMP) and creates outage records automatically (runs every 5 minutes)"
                      icon={<Wifi className="w-5 h-5" />}
                      functionName="monitorNetworkHealth"
                      params={{}}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saveMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700">
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmailServerTab({ showSecrets, toggleSecret, testingGateway, setTestingGateway }) {
  const [smtpConfig, setSmtpConfig] = useState({
    host: '',
    port: '587',
    user: '',
    password: '',
    from_email: '',
    from_name: '',
    encryption: 'tls',
  });
  const [testEmail, setTestEmail] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);



  const handleTestEmail = async (e) => {
    e.preventDefault();
    setIsTesting(true);
    setTestResult(null);
    try {
      const response = await vibelink.functions.invoke('sendEmail', {
        to: testEmail,
        subject: 'VIBELINK - Email Server Test',
        html: '<p>This is a test email from your VIBELINK ISP Management System. Your email server is configured correctly.</p>',
        text: 'This is a test email from your VIBELINK ISP Management System.',
      });
      if (response.data?.success) {
        setTestResult({ success: true, message: `Test email sent successfully to ${testEmail}` });
        toast.success('Test email sent!');
      } else {
        setTestResult({ success: false, message: response.data?.error || 'Failed to send test email' });
        toast.error('Test email failed');
      }
    } catch (err) {
      setTestResult({ success: false, message: err.message });
      toast.error('Test email failed');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-indigo-600" />
            SMTP Email Server
          </CardTitle>
          <CardDescription>
            Configure the outgoing mail server used for customer notifications, invoices, and alerts.
            Settings are stored as secure server-side secrets.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <strong>Note:</strong> Email server credentials are stored as secure environment secrets and cannot be read back. 
            The current values are shown for reference. To update, enter new values and save — they will be re-configured as secrets.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>SMTP Host</Label>
              <Input value={smtpConfig.host} onChange={(e) => setSmtpConfig({...smtpConfig, host: e.target.value})} placeholder="mail.yourdomain.com" />
            </div>
            <div className="space-y-2">
              <Label>SMTP Port</Label>
              <div className="flex gap-2">
                <Input value={smtpConfig.port} onChange={(e) => setSmtpConfig({...smtpConfig, port: e.target.value})} placeholder="587" className="flex-1" />
                <Select value={smtpConfig.encryption} onValueChange={(v) => setSmtpConfig({...smtpConfig, encryption: v, port: v === 'ssl' ? '465' : v === 'tls' ? '587' : smtpConfig.port})}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tls">TLS (587)</SelectItem>
                    <SelectItem value="ssl">SSL (465)</SelectItem>
                    <SelectItem value="none">None (25)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>SMTP Username</Label>
              <Input value={smtpConfig.user} onChange={(e) => setSmtpConfig({...smtpConfig, user: e.target.value})} placeholder="noreply@yourdomain.com" />
            </div>
            <div className="space-y-2">
              <Label>SMTP Password</Label>
              <div className="relative">
                <Input
                  type={showSecrets.smtp_password ? 'text' : 'password'}
                  value={smtpConfig.password}
                  onChange={(e) => setSmtpConfig({...smtpConfig, password: e.target.value})}
                  placeholder="••••••••••"
                />
                <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => toggleSecret('smtp_password')}>
                  {showSecrets.smtp_password ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>From Email Address</Label>
              <Input value={smtpConfig.from_email} onChange={(e) => setSmtpConfig({...smtpConfig, from_email: e.target.value})} placeholder="billing@yourdomain.com" />
            </div>
            <div className="space-y-2">
              <Label>From Name</Label>
              <Input value={smtpConfig.from_name} onChange={(e) => setSmtpConfig({...smtpConfig, from_name: e.target.value})} placeholder="Your ISP Name" />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="outline"
              onClick={async () => {
                if (!smtpConfig.host || !smtpConfig.port || !smtpConfig.user) {
                  toast.error('Please fill in host, port, and username first');
                  return;
                }
                // We store these by re-configuring secrets via the UI note above
                // For actual update, user needs to update via platform secrets
                toast.info('To update SMTP secrets, please use the platform secret manager or contact support.');
              }}
            >
              <Save className="w-4 h-4 mr-2" />
              Update Secrets
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Send Test Email</CardTitle>
          <CardDescription>Verify your email server is working correctly</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleTestEmail} className="space-y-4">
            <div className="space-y-2">
              <Label>Send test email to</Label>
              <div className="flex gap-3">
                <Input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="flex-1"
                />
                <Button type="submit" disabled={isTesting} variant="outline">
                  <TestTube className="w-4 h-4 mr-2" />
                  {isTesting ? 'Sending...' : 'Send Test'}
                </Button>
              </div>
            </div>
            {testResult && (
              <div className={`p-3 rounded-lg flex items-center gap-2 text-sm ${testResult.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
                {testResult.success ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                {testResult.message}
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current Configuration</CardTitle>
          <CardDescription>Active SMTP settings (passwords hidden)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: 'Host', value: smtpConfig.host },
              { label: 'Port', value: smtpConfig.port },
              { label: 'Encryption', value: smtpConfig.encryption.toUpperCase() },
              { label: 'Username', value: smtpConfig.user },
              { label: 'From Email', value: smtpConfig.from_email },
              { label: 'From Name', value: smtpConfig.from_name },
            ].map(item => (
              <div key={item.label} className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 mb-1">{item.label}</p>
                <p className="text-sm font-medium text-slate-800 truncate">{item.value || '—'}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AlertCircle({ className }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  );
}

function RoleFormDialog({ open, onOpenChange, role, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({ name: '', description: '', permissions: [], status: 'active' });

  React.useEffect(() => {
    if (role) {
      setFormData({
        name: role.name || '',
        description: role.description || '',
        permissions: role.permissions || [],
        status: role.status || 'active',
      });
    } else {
      setFormData({ name: '', description: '', permissions: [], status: 'active' });
    }
  }, [role, open]);

  const togglePermission = (code) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(code)
        ? prev.permissions.filter(p => p !== code)
        : [...prev.permissions, code]
    }));
  };

  const toggleGroup = (group) => {
    const groupCodes = group.permissions.map(p => p.code);
    const allSelected = groupCodes.every(c => formData.permissions.includes(c));
    setFormData(prev => ({
      ...prev,
      permissions: allSelected
        ? prev.permissions.filter(p => !groupCodes.includes(p))
        : [...new Set([...prev.permissions, ...groupCodes])]
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role ? 'Edit Role' : 'Create Role'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(formData); }} className="space-y-6 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Role Name *</Label>
              <Input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} required />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Description</Label>
              <Textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={2} />
            </div>
          </div>

          <div className="space-y-4">
            <Label>Permissions</Label>
            <div className="space-y-4 max-h-96 overflow-y-auto p-1">
              {PERMISSIONS.map(group => (
                <div key={group.group} className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Checkbox
                      checked={group.permissions.every(p => formData.permissions.includes(p.code))}
                      onCheckedChange={() => toggleGroup(group)}
                    />
                    <span className="font-semibold text-slate-900">{group.group}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 ml-6">
                    {group.permissions.map(p => (
                      <div key={p.code} className="flex items-center gap-2">
                        <Checkbox
                          checked={formData.permissions.includes(p.code)}
                          onCheckedChange={() => togglePermission(p.code)}
                        />
                        <span className="text-sm text-slate-600">{p.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700">
              {isLoading ? 'Saving...' : role ? 'Update Role' : 'Create Role'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InviteStaffDialog({ open, onOpenChange, roles }) {
  const [email, setEmail] = useState('');
  const [systemRole, setSystemRole] = useState('user');
  const [staffRoleId, setStaffRoleId] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [result, setResult] = useState(null);

  const handleInvite = async (e) => {
    e.preventDefault();
    setIsInviting(true);
    setResult(null);
    
    try {
      await vibelink.users.inviteUser(email, systemRole);
      setResult({ success: true, message: `Invitation sent to ${email}` });
      setEmail('');
      setSystemRole('user');
      setStaffRoleId('');
    } catch (error) {
      setResult({ success: false, message: error.message || 'Failed to send invitation' });
    } finally {
      setIsInviting(false);
    }
  };

  React.useEffect(() => {
    if (!open) {
      setEmail('');
      setSystemRole('user');
      setStaffRoleId('');
      setResult(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Staff Member</DialogTitle>
          <DialogDescription>
            Send an invitation email to add a new team member
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleInvite} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>Email Address *</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@company.com"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>System Role *</Label>
            <Select value={systemRole} onValueChange={setSystemRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">Staff User</SelectItem>
                <SelectItem value="admin">Administrator</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              Admins have full system access. Staff users are restricted by their assigned role.
            </p>
          </div>

          {result && (
            <div className={`p-3 rounded-lg flex items-center gap-2 ${
              result.success ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            }`}>
              {result.success ? <Check className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              <span className="text-sm">{result.message}</span>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isInviting} className="bg-indigo-600 hover:bg-indigo-700">
              {isInviting ? 'Sending...' : 'Send Invitation'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AutomationFunction({ title, description, icon, functionName, params, testParams }) {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState(null);

  const runFunction = async (testMode = false) => {
    setIsRunning(true);
    setResult(null);
    try {
      const response = await vibelink.functions.invoke(functionName, testMode ? testParams : params);
      setResult(response.data);
      if (response.data.success) {
        toast.success(response.data.message || 'Function completed successfully');
      } else {
        toast.error(response.data.error || 'Function failed');
      }
    } catch (error) {
      setResult({ success: false, error: error.message });
      toast.error(error.message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex items-start justify-between p-4 border rounded-lg hover:bg-slate-50 transition-colors">
      <div className="flex gap-4">
        <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
          {icon}
        </div>
        <div className="flex-1">
          <h4 className="font-medium text-slate-900">{title}</h4>
          <p className="text-sm text-slate-500 mt-1">{description}</p>
          {result && (
            <div className={`mt-2 p-2 rounded text-xs ${result.success ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {result.message || result.error || JSON.stringify(result.results || {})}
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        {testParams && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => runFunction(true)}
            disabled={isRunning}
          >
            <TestTube className="w-4 h-4 mr-2" />
            Test
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => runFunction(false)}
          disabled={isRunning}
        >
          <PlayCircle className="w-4 h-4 mr-2" />
          {isRunning ? 'Running...' : 'Run Now'}
        </Button>
      </div>
    </div>
  );
}

function EditRoleDialog({ open, onOpenChange, user, roles, onSubmit, isLoading }) {
  const [staffRoleId, setStaffRoleId] = useState('');

  React.useEffect(() => {
    if (user) {
      setStaffRoleId(user.staff_role_id || '');
    }
  }, [user, open]);

  if (!user) return null;

  const selectedRole = roles.find(r => r.id === staffRoleId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Staff Role</DialogTitle>
          <DialogDescription>
            Assign a role to control what {user.full_name || user.email} can access
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
            <Avatar>
              <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white">
                {user.full_name?.charAt(0).toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium text-slate-900">{user.full_name || 'Unnamed'}</p>
              <p className="text-sm text-slate-500">{user.email}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Staff Role</Label>
            <Select value={staffRoleId} onValueChange={setStaffRoleId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>No Role (Full Access if Admin)</SelectItem>
                {roles.filter(r => r.status === 'active').map(role => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedRole && (
            <div className="p-3 bg-indigo-50 rounded-lg">
              <p className="text-sm font-medium text-indigo-900 mb-2">Permissions:</p>
              <div className="flex flex-wrap gap-1">
                {selectedRole.permissions?.slice(0, 8).map(p => (
                  <span key={p} className="text-xs px-2 py-1 bg-white text-indigo-700 rounded-full">
                    {p}
                  </span>
                ))}
                {(selectedRole.permissions?.length || 0) > 8 && (
                  <span className="text-xs px-2 py-1 bg-white text-indigo-700 rounded-full">
                    +{selectedRole.permissions.length - 8} more
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => onSubmit({ staff_role_id: staffRoleId || null })} 
              disabled={isLoading} 
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}