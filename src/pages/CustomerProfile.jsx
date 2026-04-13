import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Mail, Phone, DollarSign, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import StatusBadge from '@/components/shared/StatusBadge';
import CustomerInfoTab from '@/components/customer/CustomerInfoTab';
import CustomerPaymentsTab from '@/components/customer/CustomerPaymentsTab';
import CustomerServicesTab from '@/components/customer/CustomerServicesTab';
import CustomerStatisticsTab from '@/components/customer/CustomerStatisticsTab';
import CustomerLiveDataTab from '@/components/customer/CustomerLiveDataTab';
import CustomerCommunicationTab from '@/components/customer/CustomerCommunicationTab';
import CustomerActivityLogsTab from '@/components/customer/CustomerActivityLogsTab';
import { format } from 'date-fns';

export default function CustomerProfile() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const urlParams = new URLSearchParams(window.location.search);
  const customerId = urlParams.get('id');

  const { data: customer, isLoading, refetch: refetchCustomer } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: async () => {
      const customers = await vibelink.entities.Customer.filter({ id: customerId });
      return customers[0];
    },
    enabled: !!customerId,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['customer-payments', customerId],
    queryFn: () => vibelink.entities.Payment.filter({ customer_id: customerId }, '-created_date'),
    enabled: !!customerId,
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['customer-invoices', customerId],
    queryFn: () => vibelink.entities.Invoice.filter({ customer_id: customerId }, '-created_date'),
    enabled: !!customerId,
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ['customer-tickets', customerId],
    queryFn: () => vibelink.entities.SupportTicket.filter({ customer_id: customerId }, '-created_date'),
    enabled: !!customerId,
  });

  if (!customerId) {
    navigate('/customers');
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 dark:text-slate-400">Loading customer profile...</p>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-8 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600 dark:text-slate-400">Customer not found</p>
          <Button onClick={() => navigate('/customers')} className="mt-4">Go Back</Button>
        </div>
      </div>
    );
  }

  const totalPaid = payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + (p.amount || 0), 0);
  const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/customers')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">Customer Profile</h1>
            <p className="text-slate-500 mt-1">Manage customer information and activity</p>
          </div>
        </div>

        {/* Customer Header Card */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-t-4 border-t-indigo-500">
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row gap-6">
                <Avatar className="w-24 h-24">
                  <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-3xl font-bold">
                    {customer.full_name?.charAt(0).toUpperCase() || 'C'}
                  </AvatarFallback>
                </Avatar>
                
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{customer.full_name}</h2>
                      <p className="text-slate-500">{customer.customer_id}</p>
                    </div>
                    <StatusBadge status={customer.status} />
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                        <Mail className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Email</p>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-50">{customer.email}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                        <Phone className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Phone</p>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-50">{customer.phone}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                        <DollarSign className="w-5 h-5 text-purple-600" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Total Paid</p>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-50">KES {totalPaid.toLocaleString()}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                        <CreditCard className="w-5 h-5 text-amber-600" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Balance</p>
                        <p className={`text-sm font-medium ${customer.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          KES {Math.abs(customer.balance || 0).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-indigo-600">{payments.length}</p>
                <p className="text-sm text-slate-500">Total Payments</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-emerald-600">{invoices.length}</p>
                <p className="text-sm text-slate-500">Invoices</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-amber-600">{openTickets}</p>
                <p className="text-sm text-slate-500">Open Tickets</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-purple-600">
                  {customer.installation_date ? format(new Date(customer.installation_date), 'MMM yyyy') : 'N/A'}
                </p>
                <p className="text-sm text-slate-500">Customer Since</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="overflow-x-auto">
            <TabsList className="bg-white dark:bg-slate-900 border flex-nowrap h-auto p-1 w-max min-w-full">
              <TabsTrigger value="overview">Client Info</TabsTrigger>
              <TabsTrigger value="services">Services</TabsTrigger>
              <TabsTrigger value="payments">Billing</TabsTrigger>
              <TabsTrigger value="invoices">Invoices</TabsTrigger>
              <TabsTrigger value="statistics">Statistics</TabsTrigger>
              <TabsTrigger value="livedata">Live Data</TabsTrigger>
              <TabsTrigger value="communication">Communication</TabsTrigger>
              <TabsTrigger value="activitylogs">Activity Logs</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview">
            <CustomerInfoTab customer={customer} />
          </TabsContent>

          <TabsContent value="services">
            <CustomerServicesTab customer={customer} onCustomerUpdated={refetchCustomer} />
          </TabsContent>

          <TabsContent value="payments">
            <CustomerPaymentsTab customerId={customerId} payments={payments} invoices={invoices} />
          </TabsContent>

          <TabsContent value="invoices">
            <CustomerPaymentsTab customerId={customerId} payments={payments} invoices={invoices} defaultTab="invoices" />
          </TabsContent>

          <TabsContent value="statistics">
            <CustomerStatisticsTab customerId={customerId} payments={payments} invoices={invoices} tickets={tickets} />
          </TabsContent>

          <TabsContent value="livedata">
            <CustomerLiveDataTab customer={customer} />
          </TabsContent>

          <TabsContent value="communication">
            <CustomerCommunicationTab customer={customer} />
          </TabsContent>

          <TabsContent value="activitylogs">
            <CustomerActivityLogsTab customerId={customerId} customer={customer} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}