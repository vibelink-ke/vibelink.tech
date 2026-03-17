import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import TenantForm from './TenantForm';

export default function TenantDialog({ open, onOpenChange, tenant, onSubmit, isLoading }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tenant ? 'Edit Tenant' : 'Add New Tenant'}</DialogTitle>
          <DialogDescription>
            {tenant
              ? 'Update tenant information and subscription details'
              : 'Create a new tenant account with subscription plan'}
          </DialogDescription>
        </DialogHeader>
        <TenantForm tenant={tenant} onSubmit={onSubmit} isLoading={isLoading} />
      </DialogContent>
    </Dialog>
  );
}