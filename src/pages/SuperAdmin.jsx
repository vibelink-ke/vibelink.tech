import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import {
  Building2,
  DollarSign,
  CheckCircle,
  AlertCircle,
  XCircle,
  MoreVertical,
  Eye,
  Pause,
  Play,
  Ban,
  Search
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import StatusBadge from '@/components/shared/StatusBadge';

export default function SuperAdmin() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTenant, setSelectedTenant] = useState(null);
  const queryClient = useQueryClient();

  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => vibelink.entities.Tenant.list('-created_date'),
  });

  const { data: subscriptions = [] } = useQuery({
    queryKey: ['tenant-subscriptions'],
    queryFn: () => vibelink.entities.TenantSubscription.list('-created_date'),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['tenant-payments'],
    queryFn: () => vibelink.entities.TenantPayment.list('-created_date'),
  });

  const updateTenantMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      await vibelink.entities.Tenant.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['tenants']);
    },
  });

  const filteredTenants = tenants.filter(t =>
    t.company_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.admin_email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.subdomain?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const stats = {
    total: tenants.length,
    active: tenants.filter(t => t.status === 'active').length,
    trial: tenants.filter(t => t.status === 'trial').length,
    suspended: tenants.filter(t => t.status === 'suspended').length,
    totalRevenue: payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + p.amount, 0),
  };

  const handleStatusChange = (tenant, newStatus) => {
    updateTenantMutation.mutate({
      id: tenant.id,
      data: { status: newStatus }
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">Super Admin Dashboard</h1>
        <p className="text-slate-600 dark:text-slate-400">Manage all tenant accounts and subscriptions</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Total Tenants</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">{stats.total}</p>
              </div>
              <Building2 className="w-8 h-8 text-slate-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Active</p>
                <p className="text-3xl font-bold text-emerald-600">{stats.active}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-emerald-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Trial</p>
                <p className="text-3xl font-bold text-amber-600">{stats.trial}</p>
              </div>
              <AlertCircle className="w-8 h-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-rose-200 bg-gradient-to-br from-rose-50 to-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Suspended</p>
                <p className="text-3xl font-bold text-rose-600">{stats.suspended}</p>
              </div>
              <XCircle className="w-8 h-8 text-rose-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50 to-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Total Collected</p>
                <p className="text-2xl font-bold text-indigo-600">KES {stats.totalRevenue.toLocaleString()}</p>
              </div>
              <DollarSign className="w-8 h-8 text-indigo-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tenants..."
            className="pl-10"
          />
        </div>
      </div>

      {/* Tenants List */}
      <Card>
        <CardHeader>
          <CardTitle>All Tenants</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {filteredTenants.map((tenant, i) => (
              <motion.div
                key={tenant.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
                      {tenant.company_name?.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-900 dark:text-slate-50">{tenant.company_name}</h3>
                        <StatusBadge status={tenant.status} />
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">{tenant.admin_email}</p>
                      <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
                        <span>{tenant.subdomain}.skybridge.co.ke</span>
                        <span>•</span>
                        <span>Hotspot: {tenant.hotspot_revenue_share || 0}%</span>
                        <span>•</span>
                        <span>PPPoE: KES {tenant.pppoe_rate?.toLocaleString() || '0'}</span>
                        {tenant.trial_ends_at && tenant.status === 'trial' && (
                          <>
                            <span>•</span>
                            <span>Trial ends {format(new Date(tenant.trial_ends_at), 'MMM d')}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setSelectedTenant(tenant)}>
                        <Eye className="w-4 h-4 mr-2" />
                        View Details
                      </DropdownMenuItem>
                      {tenant.status === 'active' && (
                        <DropdownMenuItem onClick={() => handleStatusChange(tenant, 'suspended')}>
                          <Pause className="w-4 h-4 mr-2" />
                          Suspend
                        </DropdownMenuItem>
                      )}
                      {tenant.status === 'suspended' && (
                        <DropdownMenuItem onClick={() => handleStatusChange(tenant, 'active')}>
                          <Play className="w-4 h-4 mr-2" />
                          Activate
                        </DropdownMenuItem>
                      )}
                      {tenant.status === 'trial' && (
                        <DropdownMenuItem onClick={() => handleStatusChange(tenant, 'active')}>
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Activate (End Trial)
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem 
                        onClick={() => handleStatusChange(tenant, 'cancelled')}
                        className="text-rose-600"
                      >
                        <Ban className="w-4 h-4 mr-2" />
                        Cancel Subscription
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tenant Details Dialog */}
      <Dialog open={!!selectedTenant} onOpenChange={() => setSelectedTenant(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selectedTenant?.company_name}</DialogTitle>
          </DialogHeader>
          {selectedTenant && (
            <Tabs defaultValue="details">
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="subscription">Subscription</TabsTrigger>
                <TabsTrigger value="payments">Payments</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-slate-500">Company Name</p>
                    <p className="font-medium">{selectedTenant.company_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Status</p>
                    <StatusBadge status={selectedTenant.status} />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Admin Email</p>
                    <p className="font-medium">{selectedTenant.admin_email}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Admin Name</p>
                    <p className="font-medium">{selectedTenant.admin_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Subdomain</p>
                    <p className="font-medium">{selectedTenant.subdomain}.skybridge.co.ke</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Phone</p>
                    <p className="font-medium">{selectedTenant.phone}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm text-slate-500">Address</p>
                    <p className="font-medium">{selectedTenant.address}, {selectedTenant.city}, {selectedTenant.country}</p>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="subscription" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-slate-500">Hotspot Share</p>
                    <p className="font-medium">{selectedTenant.hotspot_revenue_share || 0}%</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">PPPoE Rate</p>
                    <p className="font-medium">KES {selectedTenant.pppoe_rate?.toLocaleString()}</p>
                  </div>
                  {selectedTenant.trial_ends_at && (
                    <div className="col-span-2">
                      <p className="text-sm text-slate-500">Trial Ends</p>
                      <p className="font-medium">{format(new Date(selectedTenant.trial_ends_at), 'PPP')}</p>
                    </div>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="payments">
                <div className="space-y-2">
                  {payments.filter(p => p.tenant_id === selectedTenant.id).map(payment => (
                    <div key={payment.id} className="p-3 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">KES {payment.amount?.toLocaleString()}</p>
                          <p className="text-sm text-slate-500">
                            {format(new Date(payment.created_date), 'MMM d, yyyy')}
                          </p>
                        </div>
                        <StatusBadge status={payment.status} />
                      </div>
                    </div>
                  ))}
                  {payments.filter(p => p.tenant_id === selectedTenant.id).length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-8">No payments yet</p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}