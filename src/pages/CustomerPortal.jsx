import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import {
  Wifi, FileText, CreditCard, User, LogOut, Zap,
  ArrowDown, ArrowUp, Edit2, Mail, Phone, MapPin,
  AlertCircle, CheckCircle, Clock, AlertTriangle,
  ChevronRight, DollarSign, TrendingUp, Calendar,
  Download, Eye, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import StatusBadge from '@/components/shared/StatusBadge';

export default function CustomerPortal() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceDetailsOpen, setInvoiceDetailsOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    vibelink.auth.me().then(u => {
      setUser(u);
      setLoading(false);
    }).catch(() => {
      vibelink.auth.redirectToLogin(window.location.href);
    });
  }, []);

  const { data: customers = [] } = useQuery({
    queryKey: ['portal-customer'],
    queryFn: () => vibelink.entities.Customer.list(),
    enabled: !!user,
  });

  const customer = user ? customers.find(c => c.email === user.email) : null;

  const { data: invoices = [] } = useQuery({
    queryKey: ['portal-invoices', customer?.id],
    queryFn: () => vibelink.entities.Invoice.filter({ customer_id: customer.id }, '-created_date'),
    enabled: !!customer?.id,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['portal-payments', customer?.id],
    queryFn: () => vibelink.entities.Payment.filter({ customer_id: customer.id }, '-created_date'),
    enabled: !!customer?.id,
  });

  const { data: planArr = [] } = useQuery({
    queryKey: ['portal-plan', customer?.plan_id],
    queryFn: () => vibelink.entities.ServicePlan.filter({ id: customer.plan_id }),
    enabled: !!customer?.plan_id,
  });

  const { data: outages = [] } = useQuery({
    queryKey: ['portal-outages'],
    queryFn: () => vibelink.entities.Outage.filter({ show_on_portal: true, status: { $ne: 'resolved' } }, '-created_date'),
  });

  const updateProfileMutation = useMutation({
    mutationFn: (data) => vibelink.entities.Customer.update(customer.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['portal-customer']);
      setEditOpen(false);
    },
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50">
        <div className="animate-pulse text-indigo-600 text-lg font-medium">Loading...</div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50 p-4">
        <Card className="max-w-md w-full shadow-xl">
          <CardContent className="pt-8 pb-8 text-center">
            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50 mb-2">Account Not Found</h2>
            <p className="text-slate-500 mb-6 text-sm">
              No customer account is linked to <strong>{user?.email}</strong>. Please contact support.
            </p>
            <Button onClick={() => vibelink.auth.logout()} variant="outline">
              <LogOut className="w-4 h-4 mr-2" /> Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const plan = planArr[0];
  const activeOutages = outages.filter(o => o.status !== 'resolved');
  const balance = customer.balance || 0;
  const unpaidInvoices = invoices.filter(i => i.status === 'sent' || i.status === 'overdue');
  const totalPaid = payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + (p.amount || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-800/50">
      {/* Outage Alerts */}
      {activeOutages.map(outage => (
        <div key={outage.id} className={`px-4 py-3 flex items-center gap-3 text-sm font-medium
          ${outage.severity === 'critical' ? 'bg-red-600 text-white' :
            outage.severity === 'high' ? 'bg-orange-500 text-white' : 'bg-amber-400 text-amber-900'}`}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span><strong>{outage.title}:</strong> {outage.description}</span>
        </div>
      ))}

      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-40 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 dark:text-slate-50 leading-none">VIBELINK</h1>
              <p className="text-xs text-slate-500">Customer Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{customer.full_name}</p>
              <p className="text-xs text-slate-500">{customer.customer_id}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => vibelink.auth.logout()} title="Sign Out">
              <LogOut className="w-5 h-5 text-slate-500" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-1 mb-6 flex-wrap h-auto gap-1">
            <TabsTrigger value="overview" className="gap-2 text-sm">
              <User className="w-4 h-4" /> Overview
            </TabsTrigger>
            <TabsTrigger value="service" className="gap-2 text-sm">
              <Wifi className="w-4 h-4" /> Service
            </TabsTrigger>
            <TabsTrigger value="invoices" className="gap-2 text-sm">
              <FileText className="w-4 h-4" /> Invoices
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-2 text-sm">
              <CreditCard className="w-4 h-4" /> Payments
            </TabsTrigger>
            <TabsTrigger value="account" className="gap-2 text-sm">
              <User className="w-4 h-4" /> My Account
            </TabsTrigger>
          </TabsList>

          {/* OVERVIEW */}
          <TabsContent value="overview" className="space-y-6">
            {/* Welcome Banner */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white border-0 shadow-lg">
                <CardContent className="pt-6 pb-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold mb-1">Welcome back, {customer.full_name?.split(' ')[0]}!</h2>
                      <p className="text-indigo-100 text-sm">Manage your internet service from one place.</p>
                    </div>
                    <StatusBadge status={customer.status} className="w-fit" />
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                <Card className={balance > 0 ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}>
                  <CardContent className="pt-5 pb-5">
                    <p className="text-xs text-slate-500 mb-1">Account Balance</p>
                    <p className={`text-2xl font-bold ${balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      KES {Math.abs(balance).toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">{balance > 0 ? 'Amount due' : 'No outstanding balance'}</p>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <Card>
                  <CardContent className="pt-5 pb-5">
                    <p className="text-xs text-slate-500 mb-1">Unpaid Invoices</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{unpaidInvoices.length}</p>
                    <p className="text-xs text-slate-500 mt-1">Pending payment</p>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                <Card>
                  <CardContent className="pt-5 pb-5">
                    <p className="text-xs text-slate-500 mb-1">Total Paid</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">KES {totalPaid.toLocaleString()}</p>
                    <p className="text-xs text-slate-500 mt-1">All time</p>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <Card>
                  <CardContent className="pt-5 pb-5">
                    <p className="text-xs text-slate-500 mb-1">Current Plan</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-slate-50 truncate">{plan?.name || customer.plan_name || 'N/A'}</p>
                    <p className="text-xs text-slate-500 mt-1">KES {customer.monthly_rate || plan?.monthly_price || 0}/mo</p>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            {/* Quick Links */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: 'View Invoices', desc: `${invoices.length} total invoices`, tab: 'invoices', icon: FileText, color: 'text-indigo-600 bg-indigo-50' },
                { label: 'Payment History', desc: `${payments.length} transactions`, tab: 'payments', icon: CreditCard, color: 'text-purple-600 bg-purple-50' },
                { label: 'Update Profile', desc: 'Edit contact details', tab: 'account', icon: Edit2, color: 'text-emerald-600 bg-emerald-50' },
              ].map(item => (
                <Card
                  key={item.tab}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setActiveTab(item.tab)}
                >
                  <CardContent className="pt-5 pb-5 flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl ${item.color} flex items-center justify-center flex-shrink-0`}>
                      <item.icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-slate-50 text-sm">{item.label}</p>
                      <p className="text-xs text-slate-500">{item.desc}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Recent Invoices */}
            {unpaidInvoices.length > 0 && (
              <Card className="border-rose-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base text-rose-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" /> Outstanding Invoices
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {unpaidInvoices.slice(0, 3).map(inv => (
                    <div key={inv.id} className="flex items-center justify-between p-3 bg-rose-50 rounded-lg">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-50 text-sm">{inv.invoice_number}</p>
                        <p className="text-xs text-slate-500">Due: {inv.due_date ? format(new Date(inv.due_date), 'MMM d, yyyy') : 'N/A'}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-rose-600">KES {inv.total_amount?.toLocaleString()}</p>
                        <StatusBadge status={inv.status} />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* SERVICE */}
          <TabsContent value="service" className="space-y-6">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
              {/* Connection Info */}
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wifi className="w-5 h-5 text-indigo-600" /> Connection Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                    <p className="text-xs text-slate-500 mb-1">Account Status</p>
                    <StatusBadge status={customer.status} />
                  </div>
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                    <p className="text-xs text-slate-500 mb-1">Customer ID</p>
                    <p className="font-mono font-semibold text-slate-900 dark:text-slate-50">{customer.customer_id}</p>
                  </div>
                  {customer.ip_address && (
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                      <p className="text-xs text-slate-500 mb-1">IP Address</p>
                      <p className="font-mono font-semibold text-slate-900 dark:text-slate-50">{customer.ip_address}</p>
                    </div>
                  )}
                  {customer.mac_address && (
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                      <p className="text-xs text-slate-500 mb-1">MAC Address</p>
                      <p className="font-mono font-semibold text-slate-900 dark:text-slate-50">{customer.mac_address}</p>
                    </div>
                  )}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                    <p className="text-xs text-slate-500 mb-1">Installation Date</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-50">
                      {customer.installation_date ? format(new Date(customer.installation_date), 'MMM d, yyyy') : 'N/A'}
                    </p>
                  </div>
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                    <p className="text-xs text-slate-500 mb-1">Billing Day</p>
                    <p className="font-semibold text-slate-900 dark:text-slate-50">Day {customer.billing_cycle_day || 1} of each month</p>
                  </div>
                </CardContent>
              </Card>

              {/* Plan Details */}
              {plan ? (
                <Card>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-indigo-600" /> Your Plan
                      </CardTitle>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-indigo-600">KES {plan.monthly_price?.toLocaleString()}</p>
                        <p className="text-xs text-slate-500">/month</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900 dark:text-slate-50">{plan.name}</h3>
                      {plan.description && <p className="text-slate-500 text-sm mt-1">{plan.description}</p>}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="p-4 bg-indigo-50 rounded-xl text-center">
                        <ArrowDown className="w-5 h-5 text-indigo-600 mx-auto mb-1" />
                        <p className="text-xl font-bold text-indigo-600">{plan.download_speed}</p>
                        <p className="text-xs text-slate-500">Mbps Down</p>
                      </div>
                      <div className="p-4 bg-purple-50 rounded-xl text-center">
                        <ArrowUp className="w-5 h-5 text-purple-600 mx-auto mb-1" />
                        <p className="text-xl font-bold text-purple-600">{plan.upload_speed}</p>
                        <p className="text-xs text-slate-500">Mbps Up</p>
                      </div>
                      <div className="p-4 bg-emerald-50 rounded-xl text-center">
                        <Zap className="w-5 h-5 text-emerald-600 mx-auto mb-1" />
                        <p className="text-xl font-bold text-emerald-600">{plan.data_cap === 0 ? '∞' : plan.data_cap}</p>
                        <p className="text-xs text-slate-500">{plan.data_cap === 0 ? 'Unlimited' : 'GB Data'}</p>
                      </div>
                    </div>
                    {plan.features?.length > 0 && (
                      <div className="pt-2">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Included Features</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {plan.features.map((f, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                              <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                              {typeof f === 'object' ? f.name : f}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center text-slate-500">
                    <Wifi className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    No plan information available.
                  </CardContent>
                </Card>
              )}
            </motion.div>
          </TabsContent>

          {/* INVOICES - BILLING HISTORY */}
          <TabsContent value="invoices" className="space-y-6">
            {/* Billing Summary */}
            {invoices.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
                  <Card>
                    <CardContent className="pt-5 pb-5">
                      <p className="text-xs text-slate-500 mb-1">Total Invoiced</p>
                      <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">KES {invoices.reduce((sum, i) => sum + (i.total_amount || 0), 0).toLocaleString()}</p>
                      <p className="text-xs text-slate-500 mt-1">{invoices.length} invoices</p>
                    </CardContent>
                  </Card>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                  <Card className="border-rose-200 bg-rose-50">
                    <CardContent className="pt-5 pb-5">
                      <p className="text-xs text-slate-500 mb-1">Outstanding</p>
                      <p className="text-2xl font-bold text-rose-600">KES {unpaidInvoices.reduce((sum, i) => sum + (i.total_amount || 0), 0).toLocaleString()}</p>
                      <p className="text-xs text-slate-500 mt-1">{unpaidInvoices.length} unpaid</p>
                    </CardContent>
                  </Card>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                  <Card className="border-emerald-200 bg-emerald-50">
                    <CardContent className="pt-5 pb-5">
                      <p className="text-xs text-slate-500 mb-1">Amount Paid</p>
                      <p className="text-2xl font-bold text-emerald-600">KES {totalPaid.toLocaleString()}</p>
                      <p className="text-xs text-slate-500 mt-1">All time</p>
                    </CardContent>
                  </Card>
                </motion.div>
              </div>
            )}

            {/* Billing History Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Billing History</h2>
                <p className="text-sm text-slate-500 mt-0.5">Complete chronological list of all invoices</p>
              </div>
              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">{invoices.length} invoices</span>
            </div>

            {invoices.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500 font-medium">No invoices yet</p>
                  <p className="text-xs text-slate-400 mt-1">Your invoices will appear here</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {invoices.map((invoice, i) => (
                  <motion.div
                    key={invoice.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <Card className="hover:shadow-md transition-all hover:border-indigo-200">
                      <CardContent className="py-4 px-5">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                          {/* Invoice Icon & Basic Info */}
                          <div className="flex items-center gap-4 flex-1">
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0
                              ${invoice.status === 'paid' ? 'bg-emerald-100' :
                                invoice.status === 'overdue' ? 'bg-rose-100' :
                                invoice.status === 'sent' ? 'bg-amber-100' : 'bg-slate-100 dark:bg-slate-800'}`}>
                              <FileText className={`w-6 h-6
                                ${invoice.status === 'paid' ? 'text-emerald-600' :
                                  invoice.status === 'overdue' ? 'text-rose-600' :
                                  invoice.status === 'sent' ? 'text-amber-600' : 'text-slate-500'}`} />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-semibold text-slate-900 dark:text-slate-50">{invoice.invoice_number}</p>
                                <StatusBadge status={invoice.status} />
                              </div>
                              <div className="flex flex-wrap gap-x-4 text-xs text-slate-500">
                                {invoice.billing_period_start && (
                                  <span className="flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {format(new Date(invoice.billing_period_start), 'MMM d')} – {invoice.billing_period_end ? format(new Date(invoice.billing_period_end), 'MMM d, yyyy') : ''}
                                  </span>
                                )}
                                {invoice.due_date && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    Due: {format(new Date(invoice.due_date), 'MMM d, yyyy')}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Amount & Actions */}
                          <div className="flex items-center justify-between sm:justify-end gap-4 sm:flex-none">
                            <div className="text-right">
                              <p className="text-lg font-bold text-slate-900 dark:text-slate-50">KES {invoice.total_amount?.toLocaleString()}</p>
                              {invoice.tax_amount > 0 && (
                                <p className="text-xs text-slate-500">+Tax: KES {invoice.tax_amount?.toLocaleString()}</p>
                              )}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedInvoice(invoice);
                                setInvoiceDetailsOpen(true);
                              }}
                              className="gap-2"
                            >
                              <Eye className="w-4 h-4" />
                              <span className="hidden sm:inline">View</span>
                            </Button>
                          </div>
                        </div>

                        {/* Invoice Items Preview */}
                        {invoice.items?.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                            <div className="text-xs text-slate-500 space-y-1">
                              {invoice.items.slice(0, 2).map((item, j) => (
                                <div key={j} className="flex justify-between">
                                  <span className="truncate">{item.description}</span>
                                  <span className="ml-2 flex-shrink-0">KES {item.total?.toLocaleString()}</span>
                                </div>
                              ))}
                              {invoice.items.length > 2 && (
                                <p className="text-slate-400 italic">+{invoice.items.length - 2} more items</p>
                              )}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* PAYMENTS */}
          <TabsContent value="payments" className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Payment History</h2>
              <span className="text-sm text-slate-500">{payments.length} transactions</span>
            </div>

            {/* Summary */}
            {payments.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
                <Card className="border-emerald-200 bg-emerald-50">
                  <CardContent className="pt-4 pb-4 text-center">
                    <p className="text-xs text-slate-500 mb-1">Total Paid</p>
                    <p className="text-xl font-bold text-emerald-700">KES {totalPaid.toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-4 text-center">
                    <p className="text-xs text-slate-500 mb-1">Transactions</p>
                    <p className="text-xl font-bold text-slate-900 dark:text-slate-50">{payments.filter(p => p.status === 'completed').length}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-4 text-center">
                    <p className="text-xs text-slate-500 mb-1">Last Payment</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {payments[0]?.created_date ? format(new Date(payments[0].created_date), 'MMM d, yyyy') : 'N/A'}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {payments.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <CreditCard className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500">No payment records yet.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {payments.map((payment, i) => (
                  <motion.div
                    key={payment.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <Card className="hover:shadow-md transition-shadow">
                      <CardContent className="py-4 px-5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0
                              ${payment.status === 'completed' ? 'bg-emerald-100' :
                                payment.status === 'failed' ? 'bg-rose-100' : 'bg-slate-100 dark:bg-slate-800'}`}>
                              <DollarSign className={`w-5 h-5
                                ${payment.status === 'completed' ? 'text-emerald-600' :
                                  payment.status === 'failed' ? 'text-rose-600' : 'text-slate-500'}`} />
                            </div>
                            <div>
                              <p className="font-semibold text-slate-900 dark:text-slate-50">
                                {payment.payment_id || `PAY-${payment.id?.slice(0, 8).toUpperCase()}`}
                              </p>
                              <div className="flex flex-wrap gap-x-3 text-xs text-slate-500 mt-0.5">
                                <span className="capitalize">{payment.payment_method?.replace('_', ' ')}</span>
                                {payment.reference_number && <span>Ref: {payment.reference_number}</span>}
                                <span>{payment.created_date ? format(new Date(payment.created_date), 'MMM d, yyyy') : 'N/A'}</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-lg font-bold ${payment.status === 'completed' ? 'text-emerald-600' : 'text-slate-500'}`}>
                              KES {payment.amount?.toLocaleString()}
                            </p>
                            <StatusBadge status={payment.status} />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ACCOUNT */}
          <TabsContent value="account" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Contact Information</CardTitle>
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Edit2 className="w-4 h-4 mr-2" /> Edit
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
                    {customer.full_name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-slate-50">{customer.full_name}</h3>
                    <p className="text-slate-500 text-sm">{customer.customer_id}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                    <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-slate-400">Email</p>
                      <p className="font-medium text-slate-800 dark:text-slate-200 text-sm">{customer.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                    <Phone className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-slate-400">Phone</p>
                      <p className="font-medium text-slate-800 dark:text-slate-200 text-sm">{customer.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl sm:col-span-2">
                    <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-slate-400">Address</p>
                      <p className="font-medium text-slate-800 dark:text-slate-200 text-sm">{customer.address}{customer.city ? `, ${customer.city}` : ''}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Billing Summary</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                  <p className="text-xs text-slate-400 mb-1">Account Balance</p>
                  <p className={`text-2xl font-bold ${balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    KES {Math.abs(balance).toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">{balance > 0 ? 'Due' : balance < 0 ? 'Credit' : 'Settled'}</p>
                </div>
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                  <p className="text-xs text-slate-400 mb-1">Monthly Rate</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">KES {(customer.monthly_rate || plan?.monthly_price || 0).toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-1">Billed day {customer.billing_cycle_day || 1} monthly</p>
                </div>
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                  <p className="text-xs text-slate-400 mb-1">Last Payment</p>
                  <p className="font-semibold text-slate-900 dark:text-slate-50">
                    {customer.last_payment_date ? format(new Date(customer.last_payment_date), 'MMM d, yyyy') : 'N/A'}
                  </p>
                </div>
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                  <p className="text-xs text-slate-400 mb-1">Installation Date</p>
                  <p className="font-semibold text-slate-900 dark:text-slate-50">
                    {customer.installation_date ? format(new Date(customer.installation_date), 'MMM d, yyyy') : 'N/A'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Edit Profile Dialog */}
      <EditProfileDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={customer}
        onSubmit={(data) => updateProfileMutation.mutate(data)}
        isLoading={updateProfileMutation.isPending}
      />

      {/* Invoice Details Modal */}
      <InvoiceDetailsModal
        open={invoiceDetailsOpen}
        onOpenChange={setInvoiceDetailsOpen}
        invoice={selectedInvoice}
        customer={customer}
        payments={payments}
      />
      </div>
      );
      }

function EditProfileDialog({ open, onOpenChange, customer, onSubmit, isLoading }) {
  const [form, setForm] = useState({ full_name: '', phone: '', address: '', city: '' });

  useEffect(() => {
    if (customer && open) {
      setForm({
        full_name: customer.full_name || '',
        phone: customer.phone || '',
        address: customer.address || '',
        city: customer.city || '',
      });
    }
  }, [customer, open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update Contact Information</DialogTitle>
          <DialogDescription>Edit your personal and contact details below.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label>Full Name</Label>
            <Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label>Phone Number</Label>
            <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label>City</Label>
            <Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700">
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceDetailsModal({ open, onOpenChange, invoice, customer, payments }) {
  if (!invoice) return null;

  const relatedPayment = payments.find(p => p.invoice_id === invoice.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-start justify-between">
          <div>
            <DialogTitle>Invoice Details</DialogTitle>
            <DialogDescription>{invoice.invoice_number}</DialogDescription>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="text-slate-500 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </DialogHeader>

        {/* Invoice Content */}
        <div className="space-y-6 mt-4">
          {/* Header Section */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 mb-1">Invoice Number</p>
              <p className="font-semibold text-slate-900 dark:text-slate-50">{invoice.invoice_number}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Status</p>
              <StatusBadge status={invoice.status} />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Invoice Date</p>
              <p className="font-semibold text-slate-900 dark:text-slate-50">
                {invoice.created_date ? format(new Date(invoice.created_date), 'MMM d, yyyy') : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Due Date</p>
              <p className={`font-semibold ${invoice.status === 'overdue' ? 'text-rose-600' : 'text-slate-900'}`}>
                {invoice.due_date ? format(new Date(invoice.due_date), 'MMM d, yyyy') : 'N/A'}
              </p>
            </div>
          </div>

          {/* Billing Period */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
            <p className="text-xs text-slate-500 mb-2 font-medium">Billing Period</p>
            <div className="flex items-center justify-between">
              <span className="text-slate-900 dark:text-slate-50 font-medium">
                {invoice.billing_period_start ? format(new Date(invoice.billing_period_start), 'MMM d, yyyy') : 'N/A'}
              </span>
              <span className="text-slate-400">to</span>
              <span className="text-slate-900 dark:text-slate-50 font-medium">
                {invoice.billing_period_end ? format(new Date(invoice.billing_period_end), 'MMM d, yyyy') : 'N/A'}
              </span>
            </div>
          </div>

          {/* Invoice Items */}
          {invoice.items?.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-3 border-b">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Items</p>
              </div>
              <div className="divide-y">
                {invoice.items.map((item, i) => (
                  <div key={i} className="px-4 py-3 flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-50">{item.description}</p>
                      {item.quantity && (
                        <p className="text-xs text-slate-500">Qty: {item.quantity}</p>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">KES {item.total?.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Totals */}
          <div className="space-y-2 p-4 bg-indigo-50 rounded-lg">
            {invoice.subtotal > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">Subtotal</span>
                <span className="font-medium text-slate-900 dark:text-slate-50">KES {invoice.subtotal?.toLocaleString()}</span>
              </div>
            )}
            {invoice.tax_amount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">Tax ({invoice.tax_rate || 0}%)</span>
                <span className="font-medium text-slate-900 dark:text-slate-50">KES {invoice.tax_amount?.toLocaleString()}</span>
              </div>
            )}
            <div className="border-t border-indigo-200 pt-2 flex justify-between">
              <span className="font-semibold text-slate-900 dark:text-slate-50">Total Amount</span>
              <span className="text-lg font-bold text-indigo-600">KES {invoice.total_amount?.toLocaleString()}</span>
            </div>
          </div>

          {/* Payment Receipt */}
          {relatedPayment && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
                <p className="font-semibold text-emerald-900">Payment Receipt</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-emerald-700 mb-1">Payment ID</p>
                  <p className="font-medium text-emerald-900">{relatedPayment.payment_id || `PAY-${relatedPayment.id?.slice(0, 8).toUpperCase()}`}</p>
                </div>
                <div>
                  <p className="text-xs text-emerald-700 mb-1">Payment Date</p>
                  <p className="font-medium text-emerald-900">
                    {relatedPayment.created_date ? format(new Date(relatedPayment.created_date), 'MMM d, yyyy') : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-emerald-700 mb-1">Amount Paid</p>
                  <p className="font-medium text-emerald-900">KES {relatedPayment.amount?.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-emerald-700 mb-1">Method</p>
                  <p className="font-medium text-emerald-900 capitalize">{relatedPayment.payment_method?.replace('_', ' ')}</p>
                </div>
                {relatedPayment.reference_number && (
                  <div className="col-span-2">
                    <p className="text-xs text-emerald-700 mb-1">Reference Number</p>
                    <p className="font-medium text-emerald-900 font-mono">{relatedPayment.reference_number}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
              <p className="text-xs text-slate-500 mb-2 font-medium">Notes</p>
              <p className="text-sm text-slate-700 dark:text-slate-300">{invoice.notes}</p>
            </div>
          )}

          {/* Customer Info */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
            <p className="text-xs text-slate-500 mb-3 font-medium">Billed To</p>
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-slate-900 dark:text-slate-50">{customer?.full_name || invoice.customer_name}</p>
              <p className="text-slate-600 dark:text-slate-400">{customer?.email || invoice.customer_email}</p>
              <p className="text-slate-600 dark:text-slate-400">{customer?.phone}</p>
              <p className="text-slate-600 dark:text-slate-400">{customer?.address}</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button className="gap-2 bg-indigo-600 hover:bg-indigo-700">
            <Download className="w-4 h-4" />
            Download PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}