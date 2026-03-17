import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { vibelink } from '@/api/vibelinkClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Plus, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { createPageUrl } from '@/utils';
import PageHeader from '@/components/shared/PageHeader';
import TenantsList from '@/components/tenants/TenantsList';
import TenantDialog from '@/components/tenants/TenantDialog';

export default function Tenants() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);
  const queryClient = useQueryClient();

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => vibelink.entities.Tenant.list('-updated_date', 100),
  });

  const createMutation = useMutation({
    mutationFn: (data) => vibelink.entities.Tenant.create(data),
    onSuccess: (newTenant, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      setShowDialog(false);
      // If create_and_onboard was requested, trigger onboarding email and redirect
      if (variables._onboarding_action === 'create_and_onboard') {
        vibelink.functions.invoke('initiateTenantOnboarding', {
          tenant_id: newTenant.id,
          admin_email: newTenant.admin_email,
          company_name: newTenant.company_name
        }).then(() => {
          navigate(`${createPageUrl('TenantOnboarding')}?tenant_id=${newTenant.id}`);
        });
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => vibelink.entities.Tenant.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      setShowDialog(false);
      setEditingTenant(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => vibelink.entities.Tenant.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
    },
  });

  const filteredTenants = tenants.filter(tenant =>
    tenant.company_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    tenant.subdomain?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    tenant.admin_email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = (data, action) => {
    if (editingTenant) {
      updateMutation.mutate({ id: editingTenant.id, data });
    } else {
      const submitData = { ...data };
      if (action === 'create_and_onboard') {
        submitData._onboarding_action = 'create_and_onboard';
      }
      createMutation.mutate(submitData);
    }
  };

  const handleEdit = (tenant) => {
    setEditingTenant(tenant);
    setShowDialog(true);
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditingTenant(null);
  };

  const handleDelete = (tenantId) => {
    deleteMutation.mutate(tenantId);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 transition-colors duration-500">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="Tenants"
          subtitle="Manage ISP tenant subscriptions and accounts"
        >
          <Button
            onClick={() => setShowDialog(true)}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Tenant
          </Button>
        </PageHeader>

        {/* Search */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
        >
          <div className="relative">
            <Search className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search by company name, subdomain, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </motion.div>

        {/* Tenants List */}
        <AnimatePresence>
          <TenantsList
            tenants={filteredTenants}
            isLoading={isLoading}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </AnimatePresence>
      </div>

      {/* Dialog */}
      <TenantDialog
        open={showDialog}
        onOpenChange={handleCloseDialog}
        tenant={editingTenant}
        onSubmit={handleSubmit}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}