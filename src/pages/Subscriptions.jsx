import React, { useState } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { PageHeader } from '@/components/shared/PageHeader';
import { Plus, Edit2, Trash2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

export default function SubscriptionsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedSubscription, setSelectedSubscription] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    customer_id: '',
    plan_id: '',
    billing_cycle_day: '1',
    auto_renew: true,
    is_trial: false,
    trial_end_date: ''
  });

  const queryClient = useQueryClient();

  const { data: subscriptions = [] } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => vibelink.entities.CustomerSubscription.list('-renewal_date'),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => vibelink.entities.Customer.list(),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['plans'],
    queryFn: () => vibelink.entities.ServicePlan.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => vibelink.entities.CustomerSubscription.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      setIsDialogOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data) => vibelink.entities.CustomerSubscription.update(selectedSubscription.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      setIsDialogOpen(false);
      resetForm();
      setSelectedSubscription(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => vibelink.entities.CustomerSubscription.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      setSelectedSubscription(null);
    },
  });

  const resetForm = () => {
    setFormData({
      customer_id: '',
      plan_id: '',
      billing_cycle_day: '1',
      auto_renew: true,
      is_trial: false,
      trial_end_date: ''
    });
  };

  const handleOpenDialog = (subscription = null) => {
    if (subscription) {
      setSelectedSubscription(subscription);
      setFormData({
        customer_id: subscription.customer_id,
        plan_id: subscription.plan_id,
        billing_cycle_day: subscription.billing_cycle_day.toString(),
        auto_renew: subscription.auto_renew,
        is_trial: subscription.is_trial,
        trial_end_date: subscription.trial_end_date || ''
      });
    } else {
      resetForm();
      setSelectedSubscription(null);
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const customer = customers.find(c => c.id === formData.customer_id);
    const plan = plans.find(p => p.id === formData.plan_id);

    if (!customer || !plan) return;

    const today = new Date().toISOString().split('T')[0];
    const renewalDate = new Date();
    renewalDate.setDate(parseInt(formData.billing_cycle_day));

    const submitData = {
      customer_id: formData.customer_id,
      customer_name: customer.full_name,
      customer_email: customer.email,
      plan_id: formData.plan_id,
      plan_name: plan.name,
      monthly_price: plan.monthly_price,
      billing_cycle_day: parseInt(formData.billing_cycle_day),
      auto_renew: formData.auto_renew,
      is_trial: formData.is_trial,
      trial_end_date: formData.is_trial ? formData.trial_end_date : null,
      started_date: selectedSubscription?.started_date || today,
      renewal_date: selectedSubscription?.renewal_date || renewalDate.toISOString().split('T')[0],
      status: selectedSubscription?.status || 'active'
    };

    if (selectedSubscription) {
      updateMutation.mutate(submitData);
    } else {
      createMutation.mutate(submitData);
    }
  };

  const filteredSubscriptions = subscriptions.filter(sub => {
    const matchesSearch = sub.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         sub.plan_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || sub.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const columns = [
    { key: 'customer_name', label: 'Customer', render: (_, row) => <span className="font-medium">{row.customer_name}</span> },
    { key: 'plan_name', label: 'Plan' },
    { key: 'monthly_price', label: 'Monthly Price', render: (value) => `KES ${value.toLocaleString()}` },
    { key: 'status', label: 'Status', render: (value) => <StatusBadge status={value} /> },
    {
      key: 'renewal_date',
      label: 'Next Renewal',
      render: (value) => new Date(value).toLocaleDateString()
    },
    {
      key: 'auto_renew',
      label: 'Auto-Renew',
      render: (value) => <Badge variant={value ? 'default' : 'secondary'}>{value ? 'Yes' : 'No'}</Badge>
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_, row) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(row)}>
            <Edit2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => deleteMutation.mutate(row.id)}
            className="text-red-600 hover:text-red-700"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      )
    }
  ];

  const upcomingRenewals = subscriptions
    .filter(s => s.status === 'active')
    .sort((a, b) => new Date(a.renewal_date) - new Date(b.renewal_date))
    .slice(0, 5);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Subscription Management"
        subtitle="Manage customer subscriptions and billing cycles"
        onAction={() => handleOpenDialog()}
        actionLabel="New Subscription"
        actionIcon={Plus}
      />

      {/* Upcoming Renewals Alert */}
      {upcomingRenewals.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3"
        >
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-blue-900">Upcoming Renewals</p>
            <p className="text-sm text-blue-800 mt-1">
              {upcomingRenewals.length} subscription(s) renewing in the next 7 days
            </p>
          </div>
        </motion.div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Subscriptions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{subscriptions.filter(s => s.status === 'active').length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total MRR</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">KES {subscriptions.filter(s => s.status === 'active').reduce((sum, s) => sum + s.monthly_price, 0).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Paused</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{subscriptions.filter(s => s.status === 'paused').length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Cancelled</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{subscriptions.filter(s => s.status === 'cancelled').length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search customer or plan..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Subscriptions Table */}
      <DataTable columns={columns} data={filteredSubscriptions} />

      {/* Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedSubscription ? 'Edit Subscription' : 'Create Subscription'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Customer</Label>
              <Select value={formData.customer_id} onValueChange={(value) => setFormData({...formData, customer_id: value})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Service Plan</Label>
              <Select value={formData.plan_id} onValueChange={(value) => setFormData({...formData, plan_id: value})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name} - KES {p.monthly_price}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Billing Cycle Day (1-31)</Label>
              <Input
                type="number"
                min="1"
                max="31"
                value={formData.billing_cycle_day}
                onChange={(e) => setFormData({...formData, billing_cycle_day: e.target.value})}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="auto_renew"
                checked={formData.auto_renew}
                onChange={(e) => setFormData({...formData, auto_renew: e.target.checked})}
                className="rounded"
              />
              <Label htmlFor="auto_renew" className="cursor-pointer">Auto-renew on billing cycle date</Label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_trial"
                checked={formData.is_trial}
                onChange={(e) => setFormData({...formData, is_trial: e.target.checked})}
                className="rounded"
              />
              <Label htmlFor="is_trial" className="cursor-pointer">This is a trial subscription</Label>
            </div>

            {formData.is_trial && (
              <div className="space-y-2">
                <Label>Trial End Date</Label>
                <Input
                  type="date"
                  value={formData.trial_end_date}
                  onChange={(e) => setFormData({...formData, trial_end_date: e.target.value})}
                />
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {selectedSubscription ? 'Update' : 'Create'} Subscription
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}