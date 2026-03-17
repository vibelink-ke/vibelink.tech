import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import PageHeader from '@/components/shared/PageHeader';
import RolesList from '@/components/administration/RolesList';
import RoleForm from '@/components/administration/RoleForm';
import { usePermissions } from '@/components/UsePermissions';
import { AlertCircle } from 'lucide-react';

export default function Roles() {
  const [editingRole, setEditingRole] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => vibelink.entities.Role.list(),
  });

  const createMutation = useMutation({
    mutationFn: (roleData) => vibelink.entities.Role.create(roleData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => vibelink.entities.Role.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setEditingRole(null);
      setShowForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => vibelink.entities.Role.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });

  const handleSubmit = (formData) => {
    if (editingRole) {
      updateMutation.mutate({ id: editingRole.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (role) => {
    setEditingRole(role);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingRole(null);
  };

  if (!hasPermission('roles.view')) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <div>
            <h3 className="font-semibold text-red-900">Access Denied</h3>
            <p className="text-sm text-red-700">You don't have permission to manage roles.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Role Management"
        subtitle="Define custom roles and granular permissions for your team"
      />

      {showForm ? (
        <div className="bg-white rounded-lg p-6 border border-slate-200">
          <h2 className="text-lg font-semibold mb-6">
            {editingRole ? `Edit Role: ${editingRole.name}` : 'Create New Role'}
          </h2>
          <RoleForm
            role={editingRole}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={createMutation.isPending || updateMutation.isPending}
          />
        </div>
      ) : (
        <RolesList
          roles={roles}
          onEdit={handleEdit}
          onDelete={(id) => deleteMutation.mutate(id)}
          onAdd={() => setShowForm(true)}
          isLoading={isLoading || deleteMutation.isPending}
        />
      )}
    </div>
  );
}