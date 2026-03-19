import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { format, addMonths, startOfMonth, endOfMonth } from 'date-fns';
import { 
  FileText, 
  Plus, 
  Filter,
  MoreVertical,
  Eye,
  Send,
  CheckCircle,
  X,
  Play,
  AlertCircle,
  Users,
  Calendar,
  DollarSign,
  Mail,
  Loader2
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import DataTable from '@/components/shared/DataTable';
import EmptyState from '@/components/shared/EmptyState';
import SearchInput from '@/components/shared/SearchInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
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
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function Invoices() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [viewInvoice, setViewInvoice] = useState(null);
  const [activeTab, setActiveTab] = useState('list');
  const queryClient = useQueryClient();

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => vibelink.entities.Invoice.list('-created_date'),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => vibelink.entities.Customer.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => vibelink.entities.Invoice.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['invoices']);
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => vibelink.entities.Invoice.update(id, data),
    onSuccess: () => queryClient.invalidateQueries(['invoices']),
  });

  const filteredInvoices = invoices.filter(invoice => {
    const matchesSearch = 
      invoice.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      invoice.invoice_number?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || invoice.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const columns = [
    {
      header: 'Invoice',
      cell: (row) => (
        <div>
          <p className="font-medium text-slate-900 dark:text-white">{row.invoice_number || `INV-${row.id?.slice(0,6)}`}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{row.customer_name}</p>
        </div>
      )
    },
    {
      header: 'Period',
      cell: (row) => (
        <div className="text-sm text-slate-600 dark:text-slate-400">
          {row.billing_period_start && row.billing_period_end ? (
            <>
              {format(new Date(row.billing_period_start), 'MMM d')} -{' '}
              {format(new Date(row.billing_period_end), 'MMM d, yyyy')}
            </>
          ) : '-'}
        </div>
      )
    },
    {
      header: 'Due Date',
      cell: (row) => (
        <span className="text-slate-700 dark:text-slate-300">
          {row.due_date ? format(new Date(row.due_date), 'MMM d, yyyy') : '-'}
        </span>
      )
    },
    {
      header: 'Amount',
      cell: (row) => (
        <span className="font-semibold text-slate-900 dark:text-white">KES {row.total_amount?.toFixed(2)}</span>
      )
    },
    {
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} />
    },
    {
      header: '',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setViewInvoice(row)}>
              <Eye className="w-4 h-4 mr-2" />
              View Details
            </DropdownMenuItem>
            {row.status === 'draft' && (
              <DropdownMenuItem onClick={() => updateMutation.mutate({ id: row.id, data: { status: 'sent' }})}>
                <Send className="w-4 h-4 mr-2" />
                Send Invoice
              </DropdownMenuItem>
            )}
            {(row.status === 'sent' || row.status === 'overdue') && (
              <DropdownMenuItem onClick={() => updateMutation.mutate({ id: row.id, data: { status: 'paid', payment_date: new Date().toISOString() }})}>
                <CheckCircle className="w-4 h-4 mr-2" />
                Mark as Paid
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => updateMutation.mutate({ id: row.id, data: { status: 'cancelled' }})} className="text-rose-600">
              <X className="w-4 h-4 mr-2" />
              Cancel
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4 sm:p-8 transition-colors duration-500">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Invoices & Billing"
          subtitle="Manage invoices and automated billing"
          actionLabel="Create Invoice"
          onAction={() => setShowForm(true)}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white dark:bg-slate-900 border dark:border-slate-800 p-1">
            <TabsTrigger value="list" className="gap-2 dark:text-slate-400 dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-white transition-all">
              <FileText className="w-4 h-4" /> All Invoices
            </TabsTrigger>
            <TabsTrigger value="generate" className="gap-2 dark:text-slate-400 dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-white transition-all">
              <Play className="w-4 h-4" /> Auto Generate
            </TabsTrigger>
          </TabsList>

          {/* LIST TAB */}
          <TabsContent value="list" className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 max-w-md">
                <SearchInput 
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search invoices..."
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 dark:text-slate-200">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="dark:bg-slate-900 dark:border-slate-800">
                  <SelectItem value="all" className="dark:text-slate-200 dark:focus:bg-slate-800">All Status</SelectItem>
                  <SelectItem value="draft" className="dark:text-slate-200 dark:focus:bg-slate-800">Draft</SelectItem>
                  <SelectItem value="sent" className="dark:text-slate-200 dark:focus:bg-slate-800">Sent</SelectItem>
                  <SelectItem value="paid" className="dark:text-slate-200 dark:focus:bg-slate-800">Paid</SelectItem>
                  <SelectItem value="overdue" className="dark:text-slate-200 dark:focus:bg-slate-800">Overdue</SelectItem>
                  <SelectItem value="cancelled" className="dark:text-slate-200 dark:focus:bg-slate-800">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DataTable
              columns={columns}
              data={filteredInvoices}
              isLoading={isLoading}
              onRowClick={(row) => setViewInvoice(row)}
              emptyState={
                <EmptyState
                  icon={FileText}
                  title="No invoices yet"
                  description="Create your first invoice to start billing customers"
                  actionLabel="Create Invoice"
                  onAction={() => setShowForm(true)}
                />
              }
            />
          </TabsContent>

          {/* GENERATE TAB */}
          <TabsContent value="generate">
            <BulkGenerationTab customers={customers} />
          </TabsContent>
        </Tabs>

        <InvoiceFormDialog
          open={showForm}
          onOpenChange={setShowForm}
          customers={customers}
          onSubmit={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
        />

        <InvoiceDetailsSheet
          invoice={viewInvoice}
          open={!!viewInvoice}
          onOpenChange={(open) => !open && setViewInvoice(null)}
        />
      </div>
    </div>
  );
}

function BulkGenerationTab({ customers }) {
  const [selectedCustomers, setSelectedCustomers] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [sendEmails, setSendEmails] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const queryClient = useQueryClient();

  const { data: servicePlans = [] } = useQuery({
    queryKey: ['servicePlans'],
    queryFn: () => vibelink.entities.ServicePlan.list(),
  });

  const { data: settings = [] } = useQuery({
    queryKey: ['settings'],
    queryFn: () => vibelink.entities.Setting.list(),
  });

  const filteredCustomers = customers.filter(c => 
    statusFilter === 'all' ? true : c.status === statusFilter
  );

  const eligibleCustomers = filteredCustomers.filter(c => c.plan_id || c.monthly_rate > 0);

  const handleSelectAll = (checked) => {
    setSelectAll(checked);
    if (checked) {
      setSelectedCustomers(eligibleCustomers.map(c => c.id));
    } else {
      setSelectedCustomers([]);
    }
  };

  const handleSelectCustomer = (customerId, checked) => {
    if (checked) {
      setSelectedCustomers([...selectedCustomers, customerId]);
    } else {
      setSelectedCustomers(selectedCustomers.filter(id => id !== customerId));
      setSelectAll(false);
    }
  };

  const generateInvoiceNumber = () => {
    const date = new Date();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `INV-${format(date, 'yyyyMM')}-${random}`;
  };

  const generateInvoices = async () => {
    if (selectedCustomers.length === 0) return;

    setIsGenerating(true);
    const generationResults = {
      success: [],
      failed: [],
      totalAmount: 0,
    };

    const billingPeriodStart = startOfMonth(new Date());
    const billingPeriodEnd = endOfMonth(new Date());
    const dueDate = addMonths(billingPeriodStart, 1);

    const taxSetting = settings.find(s => s.key === 'tax_rate');
    const taxRate = taxSetting ? parseFloat(JSON.parse(taxSetting.value || '0')) : 0;

    for (const customerId of selectedCustomers) {
      const customer = customers.find(c => c.id === customerId);
      if (!customer) continue;

      const plan = servicePlans.find(p => p.id === customer.plan_id);
      const monthlyRate = plan?.monthly_price || customer.monthly_rate || 0;

      if (monthlyRate <= 0) {
        generationResults.failed.push({
          customer,
          reason: 'No monthly rate configured',
        });
        continue;
      }

      const outstandingBalance = customer.balance || 0;
      const subtotal = monthlyRate + (outstandingBalance > 0 ? outstandingBalance : 0);
      const taxAmount = subtotal * (taxRate / 100);
      const totalAmount = subtotal + taxAmount;

      const invoiceData = {
        invoice_number: generateInvoiceNumber(),
        customer_id: customer.id,
        customer_name: customer.full_name,
        customer_email: customer.email,
        billing_period_start: format(billingPeriodStart, 'yyyy-MM-dd'),
        billing_period_end: format(billingPeriodEnd, 'yyyy-MM-dd'),
        due_date: format(dueDate, 'yyyy-MM-dd'),
        items: [
          {
            description: `${plan?.name || 'Internet Service'} - ${format(billingPeriodStart, 'MMMM yyyy')}`,
            quantity: 1,
            unit_price: monthlyRate,
            total: monthlyRate,
          },
          ...(outstandingBalance > 0 ? [{
            description: 'Previous Balance',
            quantity: 1,
            unit_price: outstandingBalance,
            total: outstandingBalance,
          }] : []),
        ],
        subtotal,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        status: 'sent',
      };

      try {
        await vibelink.entities.Invoice.create(invoiceData);
        await vibelink.entities.Customer.update(customer.id, { balance: totalAmount });

        if (sendEmails && customer.email) {
          try {
            await vibelink.integrations.Core.SendEmail({
              to: customer.email,
              subject: `Invoice ${invoiceData.invoice_number} - ${format(billingPeriodStart, 'MMMM yyyy')}`,
              body: `
Dear ${customer.full_name},

Your invoice for ${format(billingPeriodStart, 'MMMM yyyy')} has been generated.

Invoice Number: ${invoiceData.invoice_number}
Billing Period: ${format(billingPeriodStart, 'MMM d')} - ${format(billingPeriodEnd, 'MMM d, yyyy')}
Amount Due: KES ${totalAmount.toFixed(2)}
Due Date: ${format(dueDate, 'MMMM d, yyyy')}

Please log in to your customer portal to view the full invoice and make a payment.

Thank you for your business!

Best regards,
Your ISP Team
              `.trim(),
            });
          } catch (emailError) {
            console.error('Email failed for', customer.email, emailError);
          }
        }

        await vibelink.entities.SystemLog.create({
          action: `Invoice ${invoiceData.invoice_number} generated`,
          category: 'billing',
          level: 'info',
          details: JSON.stringify({
            customer_id: customer.id,
            invoice_number: invoiceData.invoice_number,
            amount: totalAmount,
          }),
          entity_type: 'Invoice',
        });

        generationResults.success.push({
          customer,
          invoice: invoiceData,
        });
        generationResults.totalAmount += totalAmount;

      } catch (error) {
        generationResults.failed.push({
          customer,
          reason: error.message || 'Unknown error',
        });
      }
    }

    setResults(generationResults);
    setShowResults(true);
    setIsGenerating(false);
    setSelectedCustomers([]);
    setSelectAll(false);
    queryClient.invalidateQueries(['customers']);
    queryClient.invalidateQueries(['invoices']);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Invoices & Billing"
          subtitle={`${invoices.length} total invoices`}
          actionLabel="Create Invoice"
          onAction={() => setShowForm(true)}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border p-1">
            <TabsTrigger value="list" className="gap-2">
              <FileText className="w-4 h-4" /> All Invoices
            </TabsTrigger>
            <TabsTrigger value="generate" className="gap-2">
              <Play className="w-4 h-4" /> Auto Generate
            </TabsTrigger>
          </TabsList>

          {/* LIST TAB */}
          <TabsContent value="list" className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 max-w-md">
                <SearchInput 
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search invoices..."
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40 bg-white">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DataTable
              columns={columns}
              data={filteredInvoices}
              isLoading={isLoading}
              onRowClick={(row) => setViewInvoice(row)}
              emptyState={
                <EmptyState
                  icon={FileText}
                  title="No invoices yet"
                  description="Create your first invoice to start billing customers"
                  actionLabel="Create Invoice"
                  onAction={() => setShowForm(true)}
                />
              }
            />
          </TabsContent>

          {/* GENERATE TAB */}
          <TabsContent value="generate">
            <GenerateInvoicesContent
              customers={customers}
              servicePlans={servicePlans}
              settings={settings}
              onGenerate={generateInvoices}
              selectedCustomers={selectedCustomers}
              setSelectedCustomers={setSelectedCustomers}
              selectAll={selectAll}
              setSelectAll={setSelectAll}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              sendEmails={sendEmails}
              setSendEmails={setSendEmails}
              isGenerating={isGenerating}
              results={results}
              showResults={showResults}
              setShowResults={setShowResults}
              eligibleCustomers={eligibleCustomers}
              handleSelectAll={handleSelectAll}
              handleSelectCustomer={handleSelectCustomer}
            />
          </TabsContent>
        </Tabs>

        <InvoiceFormDialog
          open={showForm}
          onOpenChange={setShowForm}
          customers={customers}
          onSubmit={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
        />

        <InvoiceDetailsSheet
          invoice={viewInvoice}
          open={!!viewInvoice}
          onOpenChange={(open) => !open && setViewInvoice(null)}
        />
      </div>
    </div>
  );
}

function GenerateInvoicesContent({
  customers,
  servicePlans,
  settings,
  onGenerate,
  selectedCustomers,
  setSelectedCustomers,
  selectAll,
  setSelectAll,
  statusFilter,
  setStatusFilter,
  sendEmails,
  setSendEmails,
  isGenerating,
  results,
  showResults,
  setShowResults,
  eligibleCustomers,
  handleSelectAll,
  handleSelectCustomer
}) {
  const totalSelectedAmount = selectedCustomers.reduce((sum, id) => {
    const customer = customers.find(c => c.id === id);
    const plan = servicePlans.find(p => p.id === customer?.plan_id);
    return sum + (plan?.monthly_price || customer?.monthly_rate || 0);
  }, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="dark:bg-slate-900 dark:border-slate-800 shadow-sm">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{eligibleCustomers.length}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Eligible</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="dark:bg-slate-900 dark:border-slate-800 shadow-sm">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{selectedCustomers.length}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Selected</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="dark:bg-slate-900 dark:border-slate-800 shadow-sm">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">KES {totalSelectedAmount.toFixed(0)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Est. Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="dark:bg-slate-900 dark:border-slate-800 shadow-sm">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-lg font-bold dark:text-white">{format(new Date(), 'MMM yyyy')}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Period</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="dark:bg-slate-900 dark:border-slate-800 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 dark:text-white">
            <FileText className="w-5 h-5" />
            Generate Invoices
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex flex-wrap gap-4 items-center">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Customers</SelectItem>
                  <SelectItem value="active">Active Only</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2">
                <Switch
                  id="sendEmails"
                  checked={sendEmails}
                  onCheckedChange={setSendEmails}
                />
                <Label htmlFor="sendEmails" className="flex items-center gap-1 dark:text-slate-300">
                  <Mail className="w-4 h-4" />
                  Email notifications
                </Label>
              </div>
            </div>

            <Button
              onClick={onGenerate}
              disabled={selectedCustomers.length === 0 || isGenerating}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Generate {selectedCustomers.length} Invoice{selectedCustomers.length !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="dark:bg-slate-900 dark:border-slate-800 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                <TableHead className="w-12 dark:text-slate-400">
                  <Checkbox
                    checked={selectAll && eligibleCustomers.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead className="dark:text-slate-400">Customer</TableHead>
                <TableHead className="dark:text-slate-400">Plan</TableHead>
                <TableHead className="dark:text-slate-400">Monthly Rate</TableHead>
                <TableHead className="dark:text-slate-400">Balance</TableHead>
                <TableHead className="dark:text-slate-400">Status</TableHead>
                <TableHead className="dark:text-slate-400">Billing Day</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eligibleCustomers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-slate-500 dark:text-slate-400">
                    No eligible customers found
                  </TableCell>
                </TableRow>
              ) : (
                eligibleCustomers.map((customer) => {
                  const plan = servicePlans.find(p => p.id === customer.plan_id);
                  const monthlyRate = plan?.monthly_price || customer.monthly_rate || 0;
                  
                  return (
                    <TableRow key={customer.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 dark:border-slate-800">
                      <TableCell>
                        <Checkbox
                          checked={selectedCustomers.includes(customer.id)}
                          onCheckedChange={(checked) => handleSelectCustomer(customer.id, checked)}
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white">{customer.full_name}</p>
                          <p className="text-sm text-slate-500 dark:text-slate-400">{customer.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-slate-700 dark:text-slate-300">{plan?.name || customer.plan_name || '-'}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold text-slate-900 dark:text-white">KES {monthlyRate.toFixed(2)}</span>
                      </TableCell>
                      <TableCell>
                        <span className={`font-medium ${(customer.balance || 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          KES {Math.abs(customer.balance || 0).toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={customer.status} />
                      </TableCell>
                      <TableCell>
                        <span className="text-slate-600 dark:text-slate-400">Day {customer.billing_cycle_day || 1}</span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showResults} onOpenChange={setShowResults}>
        <DialogContent className="max-w-lg dark:bg-slate-900 dark:border-slate-800 transition-colors duration-500">
          <DialogHeader>
            <DialogTitle className="dark:text-white">Invoice Generation Complete</DialogTitle>
          </DialogHeader>
          {results && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl text-center">
                  <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{results.success.length}</p>
                  <p className="text-sm text-emerald-600 dark:text-emerald-500">Successful</p>
                </div>
                <div className="p-4 bg-rose-50 dark:bg-rose-900/20 rounded-xl text-center">
                  <X className="w-8 h-8 text-rose-600 dark:text-rose-400 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-rose-700 dark:text-rose-400">{results.failed.length}</p>
                  <p className="text-sm text-rose-600 dark:text-rose-500">Failed</p>
                </div>
              </div>

              <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl text-center">
                <p className="text-sm text-indigo-600 dark:text-indigo-400 mb-1">Total Amount Generated</p>
                <p className="text-3xl font-bold text-indigo-700 dark:text-indigo-400">KES {results.totalAmount.toFixed(2)}</p>
              </div>

              {results.failed.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium text-slate-700 dark:text-slate-300">Failed Invoices:</p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {results.failed.map((item, i) => (
                      <div key={i} className="text-sm p-2 bg-rose-50 dark:bg-rose-900/20 rounded-lg dark:text-slate-300">
                        <span className="font-medium">{item.customer.full_name}</span>: {item.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setShowResults(false)} className="bg-indigo-600 hover:bg-indigo-700">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvoiceFormDialog({ open, onOpenChange, customers, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({
    customer_id: '',
    customer_name: '',
    customer_email: '',
    billing_period_start: '',
    billing_period_end: '',
    due_date: '',
    items: [{ description: 'Monthly Service', quantity: 1, unit_price: 0, total: 0 }],
    tax_rate: 0,
    notes: '',
    status: 'draft',
  });

  const handleCustomerChange = (customerId) => {
    const customer = customers.find(c => c.id === customerId);
    if (customer) {
      setFormData(prev => ({
        ...prev,
        customer_id: customerId,
        customer_name: customer.full_name,
        customer_email: customer.email,
        items: [{ 
          description: `Monthly Service - ${customer.plan_name || 'Standard'}`, 
          quantity: 1, 
          unit_price: customer.monthly_rate || 0, 
          total: customer.monthly_rate || 0 
        }]
      }));
    }
  };

  const updateItem = (index, field, value) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    if (field === 'quantity' || field === 'unit_price') {
      newItems[index].total = (newItems[index].quantity || 0) * (newItems[index].unit_price || 0);
    }
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { description: '', quantity: 1, unit_price: 0, total: 0 }]
    }));
  };

  const removeItem = (index) => {
    if (formData.items.length > 1) {
      setFormData(prev => ({
        ...prev,
        items: prev.items.filter((_, i) => i !== index)
      }));
    }
  };

  const subtotal = formData.items.reduce((sum, item) => sum + (item.total || 0), 0);
  const taxAmount = subtotal * (formData.tax_rate / 100);
  const total = subtotal + taxAmount;

  const handleSubmit = (e) => {
    e.preventDefault();
    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
    onSubmit({
      ...formData,
      invoice_number: invoiceNumber,
      subtotal,
      tax_amount: taxAmount,
      total_amount: total,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto dark:bg-slate-900 dark:border-slate-800 transition-colors duration-500">
        <DialogHeader>
          <DialogTitle className="dark:text-white">Create Invoice</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2 sm:col-span-2">
              <Label className="dark:text-slate-300">Customer *</Label>
              <Select value={formData.customer_id} onValueChange={handleCustomerChange}>
                <SelectTrigger className="dark:bg-slate-800 dark:border-slate-700 dark:text-white">
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent className="dark:bg-slate-900 dark:border-slate-800">
                  {customers.filter(c => c.status === 'active').map(customer => (
                    <SelectItem key={customer.id} value={customer.id} className="dark:text-slate-200 dark:focus:bg-slate-800 transition-colors">
                      {customer.full_name} - {customer.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="dark:text-slate-300">Billing Period Start</Label>
              <Input
                type="date"
                value={formData.billing_period_start}
                onChange={(e) => setFormData({...formData, billing_period_start: e.target.value})}
                className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="dark:text-slate-300">Billing Period End</Label>
              <Input
                type="date"
                value={formData.billing_period_end}
                onChange={(e) => setFormData({...formData, billing_period_end: e.target.value})}
                className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="dark:text-slate-300">Due Date *</Label>
              <Input
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({...formData, due_date: e.target.value})}
                className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                required
              />
            </div>

            <div className="space-y-2">
              <Label className="dark:text-slate-300">Tax Rate (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.tax_rate}
                onChange={(e) => setFormData({...formData, tax_rate: Number(e.target.value)})}
                className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="dark:text-white">Line Items</Label>
              <Button type="button" variant="outline" size="sm" onClick={addItem} className="dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800">
                <Plus className="w-4 h-4 mr-1" /> Add Item
              </Button>
            </div>
            {formData.items.map((item, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5">
                  <Input
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) => updateItem(index, 'description', e.target.value)}
                    className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    type="number"
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={(e) => updateItem(index, 'quantity', Number(e.target.value))}
                    className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Price"
                    value={item.unit_price}
                    onChange={(e) => updateItem(index, 'unit_price', Number(e.target.value))}
                    className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                  />
                </div>
                <div className="col-span-2 text-right font-medium dark:text-white">
                  KES {item.total.toFixed(2)}
                </div>
                <div className="col-span-1">
                  {formData.items.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)}>
                      <X className="w-4 h-4 text-slate-400" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">Subtotal</span>
              <span className="font-medium text-slate-900 dark:text-white">KES {subtotal.toFixed(2)}</span>
            </div>
            {formData.tax_rate > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">Tax ({formData.tax_rate}%)</span>
                <span className="font-medium text-slate-900 dark:text-white">KES {taxAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold border-t border-slate-200 dark:border-slate-700 pt-2 text-slate-900 dark:text-white">
              <span>Total</span>
              <span>KES {total.toFixed(2)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="dark:text-slate-300">Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
              placeholder="Additional notes..."
              rows={2}
              className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800">
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700">
              {isLoading ? 'Creating...' : 'Create Invoice'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceDetailsSheet({ invoice, open, onOpenChange }) {
  if (!invoice) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto dark:bg-slate-900 dark:border-slate-800 transition-colors duration-500">
        <SheetHeader>
          <SheetTitle className="dark:text-white">Invoice Details</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{invoice.invoice_number || `INV-${invoice.id?.slice(0,6)}`}</h3>
              <p className="text-slate-500 dark:text-slate-400">{invoice.customer_name}</p>
            </div>
            <StatusBadge status={invoice.status} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-xl">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Billing Period</p>
              <p className="font-medium text-slate-900 dark:text-white">
                {invoice.billing_period_start && invoice.billing_period_end ? (
                  <>
                    {format(new Date(invoice.billing_period_start), 'MMM d')} -{' '}
                    {format(new Date(invoice.billing_period_end), 'MMM d')}
                  </>
                ) : '-'}
              </p>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-xl">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Due Date</p>
              <p className="font-medium text-slate-900 dark:text-white">
                {invoice.due_date ? format(new Date(invoice.due_date), 'MMM d, yyyy') : '-'}
              </p>
            </div>
          </div>

          {invoice.items?.length > 0 && (
            <div className="space-y-4">
              <h4 className="font-semibold text-slate-900 dark:text-white">Line Items</h4>
              <div className="space-y-2">
                {invoice.items.map((item, i) => (
                  <div key={i} className="flex justify-between p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-xl">
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">{item.description}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{item.quantity} × KES {item.unit_price?.toFixed(2)}</p>
                    </div>
                    <p className="font-bold text-slate-900 dark:text-white">KES {item.total?.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-slate-900 text-white rounded-xl p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-300">Subtotal</span>
              <span>KES {invoice.subtotal?.toFixed(2) || 0}</span>
            </div>
            {invoice.tax_amount > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-300">Tax ({invoice.tax_rate}%)</span>
                <span>KES {invoice.tax_amount?.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold border-t border-slate-700 pt-2">
              <span>Total</span>
              <span>KES {invoice.total_amount?.toFixed(2)}</span>
            </div>
          </div>

          {invoice.notes && (
            <div className="space-y-2">
              <h4 className="font-semibold text-slate-900 dark:text-white">Notes</h4>
              <p className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-xl text-slate-700 dark:text-slate-300 text-sm">{invoice.notes}</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}