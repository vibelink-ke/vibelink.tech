import React, { useState } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CreditCard, FileText, TrendingUp, AlertCircle } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import InvoiceTable from '@/components/billing/InvoiceTable';
import PaymentHistory from '@/components/billing/PaymentHistory';
import InvoicePreview from '@/components/billing/InvoicePreview';
import PaymentDialog from '@/components/billing/PaymentDialog';
import { format } from 'date-fns';

export default function TenantBilling() {
  const [isAnnual, setIsAnnual] = useState(false);
  const [previewInvoice, setPreviewInvoice] = useState(null);
  const [paymentInvoice, setPaymentInvoice] = useState(null);
  const queryClient = useQueryClient();



  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => vibelink.entities.Invoice.filter({}, '-created_date', 50)
  });

  const { data: payments = [], isLoading: paymentsLoading } = useQuery({
    queryKey: ['tenant-payments'],
    queryFn: () => vibelink.entities.TenantPayment.filter({}, '-created_date', 50)
  });

  const { data: subscription } = useQuery({
    queryKey: ['current-subscription'],
    queryFn: async () => {
      const subs = await vibelink.entities.TenantSubscription.filter({}, '-created_date', 1);
      return subs?.[0];
    }
  });

  const { data: tenant } = useQuery({
    queryKey: ['current-tenant'],
    queryFn: async () => {
      const tenants = await vibelink.entities.Tenant.filter({}, '-created_date', 1);
      return tenants?.[0];
    }
  });



  // Calculate billing stats
  const totalPaid = payments
    .filter(p => p.status === 'completed')
    .reduce((sum, p) => sum + p.amount, 0);

  const totalDue = invoices
    .filter(i => i.status === 'sent' || i.status === 'overdue')
    .reduce((sum, i) => sum + i.total_amount, 0);

  const nextBillingDate = subscription?.next_billing_date;
  const daysUntilBilling = nextBillingDate 
    ? Math.ceil((new Date(nextBillingDate) - new Date()) / (1000 * 60 * 60 * 24))
    : null;

  const handleViewInvoice = (invoice) => {
    setPreviewInvoice(invoice);
  };

  const handleDownloadInvoice = (invoice) => {
    setPreviewInvoice(invoice);
  };



  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-800/50 p-6">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="Billing & Subscriptions"
          subtitle="Manage your subscription, invoices, and payments"
        />

        {/* Billing Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Current Rates</p>
                  <CreditCard className="w-4 h-4 text-indigo-600" />
                </div>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                   {tenant?.hotspot_revenue_share || 0}% Hotspot
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  KES {tenant?.pppoe_rate?.toLocaleString() || 0} per PPPoE
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Total Paid</p>
                  <TrendingUp className="w-4 h-4 text-green-600" />
                </div>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                  KES {totalPaid.toLocaleString('en-KE')}
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  {payments.filter(p => p.status === 'completed').length} payments
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Amount Due</p>
                  <AlertCircle className={`w-4 h-4 ${totalDue > 0 ? 'text-red-600' : 'text-green-600'}`} />
                </div>
                <p className={`text-2xl font-bold ${totalDue > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                  KES {totalDue.toLocaleString('en-KE')}
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  {invoices.filter(i => i.status === 'sent' || i.status === 'overdue').length} outstanding
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Next Billing</p>
                  <FileText className="w-4 h-4 text-indigo-600" />
                </div>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                  {daysUntilBilling !== null ? `${daysUntilBilling}d` : 'N/A'}
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  {nextBillingDate ? format(new Date(nextBillingDate), 'MMM d, yyyy') : 'Not scheduled'}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="invoices" className="space-y-6">
          <TabsList>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
          </TabsList>

          <TabsContent value="invoices">
            <InvoiceTable
              invoices={invoices}
              isLoading={invoicesLoading}
              onViewInvoice={handleViewInvoice}
              onDownloadInvoice={handleDownloadInvoice}
            />
          </TabsContent>

          <TabsContent value="payments">
            <PaymentHistory
              payments={payments}
              isLoading={paymentsLoading}
              invoices={invoices}
              onPayInvoice={setPaymentInvoice}
            />
          </TabsContent>


        </Tabs>

        {/* Invoice Preview Dialog */}
        <InvoicePreview
          invoice={previewInvoice}
          open={!!previewInvoice}
          onOpenChange={(open) => !open && setPreviewInvoice(null)}
        />

        {/* Payment Dialog */}
        {paymentInvoice && tenant && (
          <PaymentDialog
            invoice={paymentInvoice}
            tenant={tenant}
            open={!!paymentInvoice}
            onOpenChange={(open) => !open && setPaymentInvoice(null)}
            onPaymentSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['tenant-payments'] });
              setPaymentInvoice(null);
            }}
          />
        )}
      </div>
    </div>
  );
}