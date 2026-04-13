import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { 
  CreditCard, 
  Filter,
  Wallet,
  Building,
  Smartphone
} from 'lucide-react';
import { format } from 'date-fns';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import DataTable from '@/components/shared/DataTable';
import EmptyState from '@/components/shared/EmptyState';
import SearchInput from '@/components/shared/SearchInput';
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

const paymentMethodIcons = {
  cash: Wallet,
  bank_transfer: Building,
  credit_card: CreditCard,
  e_wallet: Smartphone,
  other: CreditCard,
};

export default function Finance() {
  const [searchQuery, setSearchQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: () => vibelink.entities.Payment.list('-created_date'),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => vibelink.entities.Customer.list(),
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => vibelink.entities.Invoice.filter({ status: 'sent' }),
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const payment = await vibelink.entities.Payment.create(data);
      // Update invoice status if linked
      if (data.invoice_id) {
        await vibelink.entities.Invoice.update(data.invoice_id, { 
          status: 'paid',
          payment_date: new Date().toISOString(),
          payment_method: data.payment_method
        });
      }
      // Update customer balance
      const customer = customers.find(c => c.id === data.customer_id);
      if (customer) {
        await vibelink.entities.Customer.update(data.customer_id, {
          balance: (customer.balance || 0) - data.amount,
          last_payment_date: new Date().toISOString()
        });
      }
      return payment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['payments']);
      queryClient.invalidateQueries(['invoices']);
      queryClient.invalidateQueries(['customers']);
      setShowForm(false);
    },
  });

  const filteredPayments = payments.filter(payment => {
    const matchesSearch = 
      payment.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      payment.payment_id?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMethod = methodFilter === 'all' || payment.payment_method === methodFilter;
    return matchesSearch && matchesMethod;
  });

  const columns = [
    {
      header: 'Payment',
      cell: (row) => {
        const Icon = paymentMethodIcons[row.payment_method] || CreditCard;
        return (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
              <Icon className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-50">{row.payment_id || `PAY-${row.id?.slice(0,6)}`}</p>
              <p className="text-sm text-slate-500 capitalize">{row.payment_method?.replace('_', ' ')}</p>
            </div>
          </div>
        );
      }
    },
    {
      header: 'Customer',
      cell: (row) => (
        <span className="text-slate-700 dark:text-slate-300">{row.customer_name}</span>
      )
    },
    {
      header: 'Date',
      cell: (row) => (
        <span className="text-slate-600 dark:text-slate-400">
          {row.created_date ? format(new Date(row.created_date), 'MMM d, yyyy') : '-'}
        </span>
      )
    },
    {
      header: 'Amount',
      cell: (row) => (
        <span className="font-semibold text-emerald-600">KES {row.amount?.toFixed(2)}</span>
      )
    },
    {
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} />
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Finance"
          subtitle={`${payments.length} total payments`}
          actionLabel="Record Payment"
          onAction={() => setShowForm(true)}
        />

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 max-w-md">
            <SearchInput 
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search payments..."
            />
          </div>
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className="w-full sm:w-48 bg-white dark:bg-slate-900">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Payment Method" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Methods</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
              <SelectItem value="credit_card">Credit Card</SelectItem>
              <SelectItem value="e_wallet">E-Wallet</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <DataTable
          columns={columns}
          data={filteredPayments}
          isLoading={isLoading}
          emptyState={
            <EmptyState
              icon={CreditCard}
              title="No payments recorded"
              description="Record your first payment to track customer transactions"
              actionLabel="Record Payment"
              onAction={() => setShowForm(true)}
            />
          }
        />

        <PaymentFormDialog
          open={showForm}
          onOpenChange={setShowForm}
          customers={customers}
          invoices={invoices}
          onSubmit={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
        />
      </div>
    </div>
  );
}

function PaymentFormDialog({ open, onOpenChange, customers, invoices, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({
    customer_id: '',
    customer_name: '',
    invoice_id: '',
    amount: 0,
    payment_method: 'cash',
    reference_number: '',
    notes: '',
  });

  const [customerInvoices, setCustomerInvoices] = useState([]);

  const handleCustomerChange = (customerId) => {
    const customer = customers.find(c => c.id === customerId);
    const custInvoices = invoices.filter(i => i.customer_id === customerId);
    setCustomerInvoices(custInvoices);
    
    if (customer) {
      setFormData(prev => ({
        ...prev,
        customer_id: customerId,
        customer_name: customer.full_name,
        invoice_id: '',
        amount: customer.balance || 0,
      }));
    }
  };

  const handleInvoiceChange = (invoiceId) => {
    const invoice = invoices.find(i => i.id === invoiceId);
    if (invoice) {
      setFormData(prev => ({
        ...prev,
        invoice_id: invoiceId,
        amount: invoice.total_amount || 0,
      }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const paymentId = `PAY-${Date.now().toString().slice(-6)}`;
    onSubmit({
      ...formData,
      payment_id: paymentId,
      status: 'completed',
    });
  };

  React.useEffect(() => {
    if (!open) {
      setFormData({
        customer_id: '',
        customer_name: '',
        invoice_id: '',
        amount: 0,
        payment_method: 'cash',
        reference_number: '',
        notes: '',
      });
      setCustomerInvoices([]);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>Customer *</Label>
            <Select value={formData.customer_id} onValueChange={handleCustomerChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map(customer => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.full_name} {customer.balance > 0 && `(Balance: KES ${customer.balance})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {customerInvoices.length > 0 && (
            <div className="space-y-2">
              <Label>Link to Invoice (Optional)</Label>
              <Select value={formData.invoice_id} onValueChange={handleInvoiceChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select invoice" />
                </SelectTrigger>
                <SelectContent>
                  {customerInvoices.map(invoice => (
                    <SelectItem key={invoice.id} value={invoice.id}>
                      {invoice.invoice_number} - KES {invoice.total_amount}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Amount *</Label>
            <Input
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({...formData, amount: Number(e.target.value)})}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Payment Method *</Label>
            <Select value={formData.payment_method} onValueChange={(v) => setFormData({...formData, payment_method: v})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="credit_card">Credit Card</SelectItem>
                <SelectItem value="e_wallet">E-Wallet</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Reference Number</Label>
            <Input
              value={formData.reference_number}
              onChange={(e) => setFormData({...formData, reference_number: e.target.value})}
              placeholder="Transaction reference..."
            />
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
              placeholder="Additional notes..."
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} className="bg-emerald-600 hover:bg-emerald-700">
              {isLoading ? 'Recording...' : 'Record Payment'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}