import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { motion } from 'framer-motion';
import { 
  Users, 
  Plus, 
  Filter, 
  MoreVertical,
  Edit2,
  Trash2,
  Eye,
  Mail,
  Phone,
  MapPin,
  RefreshCw,
  Copy,
  Lock
} from 'lucide-react';
import StatusBadge from '@/components/shared/StatusBadge';
import DataTable from '@/components/shared/DataTable';
import EmptyState from '@/components/shared/EmptyState';
import SearchInput from '@/components/shared/SearchInput';
import { Checkbox } from '@/components/ui/checkbox';
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
import { provisionCustomerService } from '@/components/provisioning/AutoProvisioningService';
import IPAddressSelector from '@/components/customer/IPAddressSelector';
import { toast } from 'sonner';

export default function Customers() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [viewCustomer, setViewCustomer] = useState(null);
  const queryClient = useQueryClient();

  const toggleSelection = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = (customersList) => {
    if (selectedIds.length === customersList.length && customersList.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(customersList.map(c => c.id));
    }
  };

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => vibelink.entities.Customer.list('-created_date'),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['plans'],
    queryFn: () => vibelink.entities.ServicePlan.list(),
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const customer = await vibelink.entities.Customer.create(data);
      
      // Auto-provision if plan is assigned
      if (data.plan_id) {
        const plan = plans.find(p => p.id === data.plan_id);
        if (plan) {
          toast.info('Provisioning service...');
          await provisionCustomerService(customer, plan, true);
          toast.success('Service provisioned successfully!');
        }
      }
      
      return customer;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['customers']);
      queryClient.invalidateQueries(['invoices']);
      setShowForm(false);
      setEditingCustomer(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const oldCustomer = customers.find(c => c.id === id);
      const customer = await vibelink.entities.Customer.update(id, data);
      
      // Auto-provision if plan changed
      if (data.plan_id && data.plan_id !== oldCustomer?.plan_id) {
        const plan = plans.find(p => p.id === data.plan_id);
        if (plan) {
          toast.info('Provisioning new service...');
          await provisionCustomerService({ ...oldCustomer, ...data }, plan, false);
          toast.success('Service provisioned successfully!');
        }
      }
      
      return customer;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['customers']);
      queryClient.invalidateQueries(['invoices']);
      setShowForm(false);
      setEditingCustomer(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => vibelink.entities.Customer.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer deleted');
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) {
        await vibelink.entities.Customer.delete(id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setSelectedIds([]);
      toast.success('Selected customers deleted');
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ ids, data }) => {
      for (const id of ids) {
        await vibelink.entities.Customer.update(id, data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setSelectedIds([]);
      toast.success('Selected customers updated');
    },
  });

  const activeCustomers = customers.filter(c => c.status === 'active').length;

  const filteredCustomers = customers.filter(customer => {
    const matchesSearch = 
      customer.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.customer_id?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || customer.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const columns = [
    {
      header: (
        <Checkbox 
          checked={selectedIds.length === filteredCustomers.length && filteredCustomers.length > 0} 
          onCheckedChange={() => toggleSelectAll(filteredCustomers)}
        />
      ),
      cell: (row) => (
        <Checkbox 
          checked={selectedIds.includes(row.id)} 
          onCheckedChange={() => toggleSelection(row.id)}
        />
      )
    },
    {
      header: 'Customer',
      cell: (row) => (
        <div className="flex items-center gap-3">
          <motion.div 
            whileHover={{ scale: 1.1 }}
            className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-semibold shadow-md"
          >
            {row.full_name?.charAt(0).toUpperCase()}
          </motion.div>
          <div>
            <p className="font-medium text-slate-900 dark:text-white">{row.full_name}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{row.customer_id || 'No ID'}</p>
          </div>
        </div>
      )
    },
    {
      header: 'Contact',
      cell: (row) => (
        <div className="space-y-1">
          <p className="text-sm text-slate-700 dark:text-slate-300">{row.email}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{row.phone}</p>
        </div>
      )
    },
    {
      header: 'Plan',
      cell: (row) => (
        <span className="text-slate-700 dark:text-slate-300">{row.plan_name || 'No plan'}</span>
      )
    },
    {
      header: 'Balance',
      cell: (row) => (
        <span className={`font-medium ${(row.balance || 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          KES {(row.balance || 0).toFixed(2)}
        </span>
      )
    },
    {
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} className="" />
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
            <DropdownMenuItem onClick={() => navigate(createPageUrl('CustomerProfile') + '?id=' + row.id)}>
              <Eye className="w-4 h-4 mr-2" />
              View Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setViewCustomer(row)}>
              <Eye className="w-4 h-4 mr-2" />
              Quick View
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setEditingCustomer(row); setShowForm(true); }}>
              <Edit2 className="w-4 h-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem 
              className="text-rose-600"
              onClick={() => {
                if (confirm('Delete this customer?')) deleteMutation.mutate(row.id);
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4 sm:p-8 transition-colors duration-500">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Customers</h1>
            <div className="flex items-center gap-2 mt-2">
              <p className="text-slate-500 dark:text-slate-400">{customers.length} total customers</p>
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring" }}
                className="px-2.5 py-1 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 text-xs font-semibold rounded-full"
              >
                {activeCustomers} active
              </motion.div>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <Button 
              onClick={() => { setEditingCustomer(null); setShowForm(true); }}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-lg shadow-indigo-200 dark:shadow-none"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Customer
            </Button>
          </motion.div>
        </div>

        {/* Filters */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col sm:flex-row gap-4"
        >
          <div className="flex-1 max-w-md">
            <SearchInput 
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search customers..."
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-40 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm dark:text-slate-200">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="terminated">Terminated</SelectItem>
            </SelectContent>
          </Select>

          <Select value={planFilter} onValueChange={setPlanFilter}>
            <SelectTrigger className="w-full sm:w-48 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm dark:text-slate-200">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="All Plans" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Plans</SelectItem>
              {plans.map(plan => (
                <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedIds.length > 0 && (
            <motion.div 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 rounded-xl shadow-sm ml-auto"
            >
              <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
                {selectedIds.length} selected
              </span>
              <div className="h-4 w-[1px] bg-indigo-200 dark:bg-indigo-800 mx-1" />
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300"
                onClick={() => bulkUpdateMutation.mutate({ ids: selectedIds, data: { status: 'suspended' } })}
              >
                Suspend
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
                onClick={() => bulkUpdateMutation.mutate({ ids: selectedIds, data: { status: 'active' } })}
              >
                Activate
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300"
                onClick={() => {
                  if(confirm(`Delete ${selectedIds.length} customers?`)) {
                    bulkDeleteMutation.mutate(selectedIds);
                  }
                }}
              >
                Delete
              </Button>
            </motion.div>
          )}
        </motion.div>

        {/* Table */}
        <DataTable
          columns={columns}
          data={filteredCustomers}
          isLoading={isLoading}
          onRowClick={() => {}}
          emptyState={
            <EmptyState
              icon={Users}
              title="No customers yet"
              description="Add your first customer to get started with billing"
              actionLabel="Add Customer"
              onAction={() => setShowForm(true)}
            />
          }
        />

        {/* Customer Form Dialog */}
        <CustomerFormDialog
          open={showForm}
          onOpenChange={setShowForm}
          customer={editingCustomer}
          plans={plans}
          onSubmit={(data) => {
            if (editingCustomer) {
              updateMutation.mutate({ id: editingCustomer.id, data });
            } else {
              createMutation.mutate(data);
            }
          }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />

        {/* Customer Details Sheet */}
        <CustomerDetailsSheet
          customer={viewCustomer}
          open={!!viewCustomer}
          onOpenChange={(open) => !open && setViewCustomer(null)}
          onEdit={(customer) => { setViewCustomer(null); setEditingCustomer(customer); setShowForm(true); }}
        />
      </div>
    </div>
  );
}

function CustomerFormDialog({ open, onOpenChange, customer, plans, onSubmit, isLoading }) {
  const { data: mikrotiks = [] } = useQuery({
    queryKey: ['mikrotiks'],
    queryFn: () => vibelink.entities.Mikrotik.list(),
  });

  const [formData, setFormData] = useState({
    customer_id: '',
    full_name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    status: 'pending',
    plan_id: '',
    plan_name: '',
    monthly_rate: 0,
    billing_cycle_day: 1,
    mac_address: '',
    ip_address: '',
    mikrotik_id: '',
    mikrotik_name: '',
    portal_username: '',
    portal_password: '',
    notes: '',
  });
  const [showPassword, setShowPassword] = useState(false);

  React.useEffect(() => {
    if (customer) {
      setFormData({
        customer_id: customer.customer_id || '',
        full_name: customer.full_name || '',
        email: customer.email || '',
        phone: customer.phone || '',
        address: customer.address || '',
        city: customer.city || '',
        status: customer.status || 'pending',
        plan_id: customer.plan_id || '',
        plan_name: customer.plan_name || '',
        monthly_rate: customer.monthly_rate || 0,
        billing_cycle_day: customer.billing_cycle_day || 1,
        mac_address: customer.mac_address || '',
        ip_address: customer.ip_address || '',
        mikrotik_id: customer.mikrotik_id || '',
        mikrotik_name: customer.mikrotik_name || '',
        portal_username: customer.portal_username || '',
        portal_password: customer.portal_password || '',
        notes: customer.notes || '',
      });
    } else {
      setFormData({
        customer_id: '',
        full_name: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        status: 'pending',
        plan_id: '',
        plan_name: '',
        monthly_rate: 0,
        billing_cycle_day: 1,
        mac_address: '',
        ip_address: '',
        mikrotik_id: '',
        mikrotik_name: '',
        portal_username: '',
        portal_password: '',
        notes: '',
      });
    }
  }, [customer, open]);

  const generateCustomerId = () => {
    const customerId = Math.floor(100000 + Math.random() * 900000).toString();
    setFormData(prev => ({
      ...prev,
      customer_id: customerId,
    }));
  };

  const generateCredentials = () => {
    const username = Math.floor(100000000 + Math.random() * 900000000).toString();
    const password = Math.floor(100000000 + Math.random() * 900000000).toString();
    setFormData(prev => ({
      ...prev,
      portal_username: username,
      portal_password: password,
    }));
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const handlePlanChange = (planId) => {
    const plan = plans.find(p => p.id === planId);
    if (plan) {
      setFormData(prev => ({
        ...prev,
        plan_id: planId,
        plan_name: plan.name,
        monthly_rate: plan.monthly_price,
      }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{customer ? 'Edit Customer' : 'Add New Customer'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center justify-between dark:text-slate-200">
                <span>Customer ID</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={generateCustomerId}
                  className="gap-1 text-xs dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="w-3 h-3" />
                  Generate
                </Button>
              </Label>
              <div className="flex gap-2">
                <Input
                  value={formData.customer_id}
                  onChange={(e) => setFormData({...formData, customer_id: e.target.value})}
                  placeholder="e.g., 123456"
                  className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                />
                {formData.customer_id && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(formData.customer_id, 'Customer ID')}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="dark:text-slate-200">Full Name *</Label>
              <Input
                value={formData.full_name}
                onChange={(e) => setFormData({...formData, full_name: e.target.value})}
                required
                className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="dark:text-slate-200">Email *</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                required
                className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="dark:text-slate-200">Phone *</Label>
              <Input
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                required
                className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Address *</Label>
              <Input
                value={formData.address}
                onChange={(e) => setFormData({...formData, address: e.target.value})}
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="dark:text-slate-200">City</Label>
              <Input
                value={formData.city}
                onChange={(e) => setFormData({...formData, city: e.target.value})}
                className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="dark:text-slate-200">Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({...formData, status: v})}>
                <SelectTrigger className="dark:bg-slate-800 dark:border-slate-700 dark:text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="dark:text-slate-200">Service Plan</Label>
              <Select value={formData.plan_id} onValueChange={handlePlanChange}>
                <SelectTrigger className="dark:bg-slate-800 dark:border-slate-700 dark:text-white">
                  <SelectValue placeholder="Select plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map(plan => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} - KES {plan.monthly_price}/mo
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="dark:text-slate-200">Billing Day</Label>
              <Select 
                value={formData.billing_cycle_day.toString()} 
                onValueChange={(v) => setFormData({...formData, billing_cycle_day: parseInt(v)})}
              >
                <SelectTrigger className="dark:bg-slate-800 dark:border-slate-700 dark:text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...Array(28)].map((_, i) => (
                    <SelectItem key={i + 1} value={(i + 1).toString()}>
                      Day {i + 1}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="dark:text-slate-200">MikroTik Router</Label>
              <Select
                value={formData.mikrotik_id}
                onValueChange={(v) => {
                  const mt = mikrotiks.find(m => m.id === v);
                  setFormData({ ...formData, mikrotik_id: v, mikrotik_name: mt?.router_name || '' });
                }}
              >
                <SelectTrigger className="dark:bg-slate-800 dark:border-slate-700 dark:text-white">
                  <SelectValue placeholder="Select router" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None</SelectItem>
                  {mikrotiks.map(mt => (
                    <SelectItem key={mt.id} value={mt.id}>
                      {mt.router_name} — {mt.ip_address}
                      {mt.status === 'online' && <span className="ml-2 text-emerald-600">●</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="dark:text-slate-200">IP Address</Label>
              <IPAddressSelector
                value={formData.ip_address}
                onChange={(v) => setFormData({ ...formData, ip_address: v })}
                excludeIds={customer ? [customer.id] : []}
                className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2 dark:text-slate-200">
                MAC Address
                <span className="text-xs font-normal text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">Auto-detected on connect</span>
              </Label>
              <Input
                value={formData.mac_address}
                onChange={(e) => setFormData({...formData, mac_address: e.target.value})}
                placeholder="Will be populated automatically"
                className="text-slate-500 dark:text-slate-400 dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
            <div className="sm:col-span-2 space-y-3 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 font-semibold dark:text-white">
                  <Lock className="w-4 h-4" />
                  Portal Login Credentials
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={generateCredentials}
                  className="gap-2 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="w-3 h-3" />
                  Generate
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="dark:text-slate-200">Username</Label>
                  <div className="flex gap-2">
                    <Input
                      value={formData.portal_username}
                      onChange={(e) => setFormData({...formData, portal_username: e.target.value})}
                      placeholder="e.g., customer.user1234"
                      className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                    />
                    {formData.portal_username && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => copyToClipboard(formData.portal_username, 'Username')}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="dark:text-slate-200">Password</Label>
                  <div className="flex gap-2">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.portal_password}
                      onChange={(e) => setFormData({...formData, portal_password: e.target.value})}
                      placeholder="Auto-generated password"
                      className="dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                    />
                    {formData.portal_password && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setShowPassword(!showPassword)}
                          title={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? '👁️' : '👁️‍🗨️'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => copyToClipboard(formData.portal_password, 'Password')}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
                placeholder="Internal notes..."
                rows={3}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700">
              {isLoading ? 'Saving...' : customer ? 'Update Customer' : 'Add Customer'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CustomerDetailsSheet({ customer, open, onOpenChange, onEdit }) {
  if (!customer) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Customer Details</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          {/* Profile Header */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-2xl font-bold">
              {customer.full_name?.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-xl font-semibold text-slate-900">{customer.full_name}</h3>
              <p className="text-slate-500">{customer.customer_id || 'No ID assigned'}</p>
              <StatusBadge status={customer.status} className="mt-2" />
            </div>
          </div>

          {/* Contact Info */}
          <div className="space-y-4">
            <h4 className="font-semibold text-slate-900">Contact Information</h4>
            <div className="space-y-2">
              <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <Mail className="w-4 h-4 text-slate-500" />
                <span className="text-slate-700">{customer.email}</span>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <Phone className="w-4 h-4 text-slate-500" />
                <span className="text-slate-700">{customer.phone}</span>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <MapPin className="w-4 h-4 text-slate-500" />
                <span className="text-slate-700">{customer.address}, {customer.city}</span>
              </div>
            </div>
          </div>

          {/* Service Info */}
          <div className="space-y-4">
            <h4 className="font-semibold text-slate-900">Service Information</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <p className="text-xs text-slate-500 mb-1">Plan</p>
                <p className="font-medium text-slate-900">{customer.plan_name || 'No plan'}</p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <p className="text-xs text-slate-500 mb-1">Monthly Rate</p>
                <p className="font-medium text-slate-900">KES {customer.monthly_rate || 0}</p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <p className="text-xs text-slate-500 mb-1">Balance</p>
                <p className={`font-medium ${(customer.balance || 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  KES {(customer.balance || 0).toFixed(2)}
                </p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <p className="text-xs text-slate-500 mb-1">Billing Day</p>
                <p className="font-medium text-slate-900">Day {customer.billing_cycle_day || 1}</p>
              </div>
            </div>
          </div>

          {/* Technical Info */}
          {(customer.mac_address || customer.ip_address) && (
            <div className="space-y-4">
              <h4 className="font-semibold text-slate-900">Technical Details</h4>
              <div className="grid grid-cols-2 gap-3">
                {customer.mac_address && (
                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                    <p className="text-xs text-slate-500 mb-1">MAC Address</p>
                    <p className="font-mono text-sm text-slate-900">{customer.mac_address}</p>
                  </div>
                )}
                {customer.ip_address && (
                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                    <p className="text-xs text-slate-500 mb-1">IP Address</p>
                    <p className="font-mono text-sm text-slate-900">{customer.ip_address}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {customer.notes && (
            <div className="space-y-4">
              <h4 className="font-semibold text-slate-900">Notes</h4>
              <p className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-slate-700 text-sm leading-relaxed">{customer.notes}</p>
            </div>
          )}

          <div className="pt-4">
            <Button onClick={() => onEdit(customer)} className="w-full bg-indigo-600 hover:bg-indigo-700">
              <Edit2 className="w-4 h-4 mr-2" />
              Edit Customer
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}