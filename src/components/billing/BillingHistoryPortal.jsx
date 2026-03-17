import React, { useState } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Download, Eye, FileText } from 'lucide-react';
import { motion } from 'framer-motion';

export default function BillingHistoryPortal({ customerEmail }) {
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: invoices = [] } = useQuery({
    queryKey: ['customer-invoices', customerEmail],
    queryFn: async () => {
      const allInvoices = await vibelink.entities.Invoice.list('-created_date');
      return allInvoices.filter(inv => inv.customer_email === customerEmail);
    },
  });

  const { data: subscription } = useQuery({
    queryKey: ['customer-subscription', customerEmail],
    queryFn: async () => {
      const subs = await vibelink.entities.CustomerSubscription.list();
      return subs.find(s => s.customer_email === customerEmail);
    },
  });

  const filteredInvoices = invoices.filter(inv =>
    statusFilter === 'all' || inv.status === statusFilter
  );

  const totalOutstanding = invoices
    .filter(inv => inv.status === 'overdue' || inv.status === 'sent')
    .reduce((sum, inv) => sum + inv.total_amount, 0);

  const totalPaid = invoices
    .filter(inv => inv.status === 'paid')
    .reduce((sum, inv) => sum + inv.total_amount, 0);

  const handleDownloadInvoice = (invoice) => {
    // Placeholder for PDF generation
    console.log('Downloading invoice:', invoice.invoice_number);
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Paid</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">KES {totalPaid.toLocaleString()}</p>
              <p className="text-xs text-slate-500 mt-1">{invoices.filter(i => i.status === 'paid').length} invoices</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Outstanding</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${totalOutstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
                KES {totalOutstanding.toLocaleString()}
              </p>
              <p className="text-xs text-slate-500 mt-1">{invoices.filter(i => i.status === 'overdue' || i.status === 'sent').length} pending</p>
            </CardContent>
          </Card>
        </motion.div>

        {subscription && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Current Plan</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium">{subscription.plan_name}</p>
                <p className="text-sm text-slate-600">KES {subscription.monthly_price.toLocaleString()}/month</p>
                <Badge className="mt-2" variant={subscription.status === 'active' ? 'default' : 'secondary'}>
                  {subscription.status}
                </Badge>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div className="flex-1">
          <Input placeholder="Search invoice number..." className="w-full" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="sent">Pending</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Invoices List */}
      <div className="space-y-3">
        {filteredInvoices.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-slate-500">
              No invoices found
            </CardContent>
          </Card>
        ) : (
          filteredInvoices.map((invoice, idx) => (
            <motion.div
              key={invoice.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="p-2 bg-slate-100 rounded-lg">
                        <FileText className="w-5 h-5 text-slate-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{invoice.invoice_number}</p>
                        <p className="text-sm text-slate-500">
                          {new Date(invoice.created_date).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </p>
                      </div>
                    </div>

                    <div className="text-right flex-1 min-w-0">
                      <p className="font-bold text-lg">KES {invoice.total_amount.toLocaleString()}</p>
                      <p className="text-sm text-slate-500">
                        Due: {new Date(invoice.due_date).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatusBadge status={invoice.status} />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedInvoice(invoice)}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDownloadInvoice(invoice)}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))
        )}
      </div>

      {/* Invoice Detail Dialog */}
      {selectedInvoice && (
        <Dialog open={!!selectedInvoice} onOpenChange={() => setSelectedInvoice(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selectedInvoice.invoice_number}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-600">Issue Date</p>
                  <p className="font-medium">{new Date(selectedInvoice.created_date).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-slate-600">Due Date</p>
                  <p className="font-medium">{new Date(selectedInvoice.due_date).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-slate-600">Status</p>
                  <StatusBadge status={selectedInvoice.status} />
                </div>
                <div>
                  <p className="text-slate-600">Amount</p>
                  <p className="font-bold">KES {selectedInvoice.total_amount.toLocaleString()}</p>
                </div>
              </div>

              {selectedInvoice.items && selectedInvoice.items.length > 0 && (
                <div className="border rounded-lg p-3">
                  <p className="font-medium text-sm mb-3">Items</p>
                  <div className="space-y-2">
                    {selectedInvoice.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span>{item.description}</span>
                        <span className="font-medium">KES {item.total.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-slate-50 p-3 rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>KES {selectedInvoice.subtotal.toLocaleString()}</span>
                </div>
                {selectedInvoice.tax_amount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Tax ({selectedInvoice.tax_rate}%)</span>
                    <span>KES {selectedInvoice.tax_amount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold pt-2 border-t">
                  <span>Total</span>
                  <span>KES {selectedInvoice.total_amount.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}