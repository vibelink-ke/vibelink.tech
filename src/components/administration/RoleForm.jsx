import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { PERMISSION_CATEGORIES, ROLE_TEMPLATES } from '@/components/PermissionsConfig';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { X } from 'lucide-react';

export default function RoleForm({ role, onSubmit, onCancel, isLoading }) {
  const [formData, setFormData] = useState(role || {
    name: '',
    description: '',
    permissions: [],
  });
  const [selectedTemplate, setSelectedTemplate] = useState('');

  const handleApplyTemplate = (templateKey) => {
    const template = ROLE_TEMPLATES[templateKey];
    if (template) {
      setFormData(prev => ({
        ...prev,
        name: template.name,
        description: template.description,
        permissions: template.permissions,
      }));
      setSelectedTemplate(templateKey);
    }
  };

  const togglePermission = (permCode) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permCode)
        ? prev.permissions.filter(p => p !== permCode)
        : [...prev.permissions, permCode],
    }));
  };

  const selectAllInCategory = (category) => {
    const categoryPermissions = PERMISSION_CATEGORIES[category].map(p => p.code);
    const allSelected = categoryPermissions.every(p => formData.permissions.includes(p));
    
    if (allSelected) {
      setFormData(prev => ({
        ...prev,
        permissions: prev.permissions.filter(p => !categoryPermissions.includes(p)),
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        permissions: [...new Set([...prev.permissions, ...categoryPermissions])],
      }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      alert('Role name is required');
      return;
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>Role Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="name">Role Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Support Agent"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of this role's responsibilities"
              className="mt-1 h-20"
            />
          </div>
        </CardContent>
      </Card>

      {/* Templates */}
      <Card>
        <CardHeader>
          <CardTitle>Role Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedTemplate} onValueChange={handleApplyTemplate}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="Apply a template (optional)" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ROLE_TEMPLATES).map(([key, template]) => (
                <SelectItem key={key} value={key}>
                  {template.name} - {template.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500 mt-2">
            Select a template to quickly set up permissions for common roles.
          </p>
        </CardContent>
      </Card>

      {/* Permissions */}
      <Card>
        <CardHeader>
          <CardTitle>Permissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {Object.entries(PERMISSION_CATEGORIES).map(([category, permissions]) => {
            const categorySelected = permissions.every(p => 
              formData.permissions.includes(p.code)
            );
            const categoryPartiallySelected = permissions.some(p => 
              formData.permissions.includes(p.code)
            ) && !categorySelected;

            return (
              <div key={category} className="space-y-3">
                <div className="flex items-center gap-3 pb-3 border-b">
                  <Checkbox
                    id={`category-${category}`}
                    checked={categorySelected}
                    indeterminate={categoryPartiallySelected}
                    onChange={() => selectAllInCategory(category)}
                    className="w-5 h-5"
                  />
                  <Label
                    htmlFor={`category-${category}`}
                    className="font-semibold text-slate-900 dark:text-slate-50 cursor-pointer flex-1"
                  >
                    {category}
                  </Label>
                  <span className="text-xs text-slate-500">
                    {permissions.filter(p => formData.permissions.includes(p.code)).length}/{permissions.length}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-8">
                  {permissions.map((permission) => (
                    <div key={permission.code} className="flex items-center gap-2">
                      <Checkbox
                        id={permission.code}
                        checked={formData.permissions.includes(permission.code)}
                        onChange={() => togglePermission(permission.code)}
                      />
                      <Label
                        htmlFor={permission.code}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {permission.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Selected Permissions Summary */}
      <Card className="bg-slate-50 dark:bg-slate-800/50">
        <CardHeader>
          <CardTitle className="text-sm">Selected Permissions</CardTitle>
        </CardHeader>
        <CardContent>
          {formData.permissions.length === 0 ? (
            <p className="text-sm text-slate-500">No permissions selected</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {formData.permissions.map((perm) => {
                const permLabel = Object.values(PERMISSION_CATEGORIES)
                  .flat()
                  .find(p => p.code === perm)?.label || perm;
                return (
                  <span
                    key={perm}
                    className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-700 text-xs px-3 py-1 rounded-full"
                  >
                    {permLabel}
                    <button
                      type="button"
                      onClick={() => togglePermission(perm)}
                      className="ml-1 hover:opacity-70"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          type="submit"
          className="bg-indigo-600 hover:bg-indigo-700"
          disabled={isLoading}
        >
          {isLoading ? 'Saving...' : 'Save Role'}
        </Button>
      </div>
    </form>
  );
}