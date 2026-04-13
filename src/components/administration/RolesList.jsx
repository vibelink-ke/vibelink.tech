import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Trash2, Edit, Plus } from 'lucide-react';
import { motion } from 'framer-motion';

export default function RolesList({ roles, onEdit, onDelete, onAdd, isLoading }) {
  const [roleToDelete, setRoleToDelete] = useState(null);

  const handleDeleteConfirm = () => {
    if (roleToDelete) {
      onDelete(roleToDelete.id);
      setRoleToDelete(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Roles</h2>
        <Button
          onClick={onAdd}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Role
        </Button>
      </div>

      {roles.length === 0 ? (
        <Card>
          <CardContent className="pt-8 text-center">
            <p className="text-slate-500">No roles created yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {roles.map((role, idx) => (
            <motion.div
              key={role.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Card className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <CardTitle className="text-base">{role.name}</CardTitle>
                        <Badge
                          variant={role.status === 'active' ? 'default' : 'secondary'}
                        >
                          {role.status}
                        </Badge>
                        {role.is_system && (
                          <Badge variant="outline">System</Badge>
                        )}
                      </div>
                      {role.description && (
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{role.description}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onEdit(role)}
                        disabled={role.is_system || isLoading}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      {!role.is_system && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRoleToDelete(role)}
                          disabled={isLoading}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {role.permissions.slice(0, 5).map((perm) => (
                      <Badge key={perm} variant="secondary" className="text-xs">
                        {perm}
                      </Badge>
                    ))}
                    {role.permissions.length > 5 && (
                      <Badge variant="secondary" className="text-xs">
                        +{role.permissions.length - 5} more
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!roleToDelete} onOpenChange={() => setRoleToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete Role</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the role "{roleToDelete?.name}"? This action cannot be undone.
          </AlertDialogDescription>
          <div className="flex gap-3 justify-end">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
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