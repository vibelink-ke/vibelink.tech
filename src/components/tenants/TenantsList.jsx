import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/shared/StatusBadge';
import EmptyState from '@/components/shared/EmptyState';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Edit2, Loader, Trash2 } from 'lucide-react';

export default function TenantsList({ tenants = [], isLoading, onEdit, onDelete }) {
  const [tenantToDelete, setTenantToDelete] = useState(null);
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (tenants.length === 0) {
    return (
      <EmptyState
        icon="building2"
        title="No Tenants Yet"
        description="Create your first tenant to get started"
      />
    );
  }



  return (
    <div className="grid gap-4">
      {tenants.map((tenant, index) => (
        <motion.div
          key={tenant.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
        >
          <Card className={`border-2 bg-white dark:bg-slate-900`}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50 dark:text-white">
                      {tenant.company_name}
                    </h3>
                    <StatusBadge status={tenant.status} />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">Subdomain</p>
                      <p className="font-mono text-slate-900 dark:text-slate-300">{tenant.subdomain}.skybridge.co.ke</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">Admin Email</p>
                      <p className="text-slate-900 dark:text-slate-300">{tenant.admin_email}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">Hotspot Share</p>
                      <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">
                        {tenant.hotspot_revenue_share || 0}%
                      </Badge>
                    </div>
                    <div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">PPPoE Rate</p>
                      <p className="text-slate-900 dark:text-slate-50 dark:text-white font-semibold">
                        KES {tenant.pppoe_rate?.toLocaleString() || '0'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-2 gap-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">Onboarded</p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-50 dark:text-white">
                        {tenant.onboarded ? 'Yes' : 'No'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">Trial Ends</p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-50 dark:text-white">
                        {tenant.trial_ends_at
                          ? new Date(tenant.trial_ends_at).toLocaleDateString()
                          : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => onEdit(tenant)}
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setTenantToDelete(tenant)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!tenantToDelete} onOpenChange={(open) => !open && setTenantToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tenant</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{tenantToDelete?.company_name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-3">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete(tenantToDelete.id);
                setTenantToDelete(null);
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}