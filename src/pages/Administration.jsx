import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { auditLog } from '@/components/shared/AuditLogger';
import { motion } from 'framer-motion';
import { 
  Shield,
  Users,
  Plus,
  Edit2,
  Trash2,
  Check,
  UserPlus,
  MoreVertical,
  Search,
  XCircle
} from 'lucide-react';
import { format } from 'date-fns';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import StatusBadge from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

const PERMISSIONS = [
  { group: 'Customers', permissions: [
    { code: 'customers.view', label: 'View Customers' },
    { code: 'customers.create', label: 'Create Customers' },
    { code: 'customers.edit', label: 'Edit Customers' },
    { code: 'customers.delete', label: 'Delete Customers' },
  ]},
  { group: 'Billing', permissions: [
    { code: 'invoices.view', label: 'View Invoices' },
    { code: 'invoices.create', label: 'Create Invoices' },
    { code: 'invoices.edit', label: 'Edit Invoices' },
    { code: 'payments.view', label: 'View Payments' },
    { code: 'payments.create', label: 'Record Payments' },
  ]},
  { group: 'Support', permissions: [
    { code: 'tickets.view', label: 'View Tickets' },
    { code: 'tickets.create', label: 'Create Tickets' },
    { code: 'tickets.manage', label: 'Manage Tickets' },
  ]},
  { group: 'Hotspot', permissions: [
    { code: 'hotspot.view', label: 'View Hotspots' },
    { code: 'hotspot.manage', label: 'Manage Hotspots' },
    { code: 'vouchers.generate', label: 'Generate Vouchers' },
  ]},
  { group: 'Messaging', permissions: [
    { code: 'messages.view', label: 'View Messages' },
    { code: 'messages.send', label: 'Send Messages' },
    { code: 'sms.send', label: 'Send SMS' },
  ]},
  { group: 'Reports', permissions: [
    { code: 'reports.view', label: 'View Reports' },
    { code: 'reports.export', label: 'Export Reports' },
  ]},
  { group: 'Settings', permissions: [
    { code: 'settings.view', label: 'View Settings' },
    { code: 'settings.edit', label: 'Edit Settings' },
    { code: 'roles.manage', label: 'Manage Roles' },
    { code: 'users.manage', label: 'Manage Users' },
    { code: 'logs.view', label: 'View Logs' },
  ]},
];

export default function Administration() {
  const [activeTab, setActiveTab] = useState('roles');

  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tab = urlParams.get('tab');
    if (tab) {
      setActiveTab(tab);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-8 transition-colors duration-500">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader 
          title="Administration" 
          subtitle="Manage roles, permissions, and staff access"
          actionLabel="Quick Action"
          onAction={() => {}}
        >
          <div />
        </PageHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border p-1">
            <TabsTrigger value="roles" className="gap-2">
              <Shield className="w-4 h-4" /> Roles & Permissions
            </TabsTrigger>
            <TabsTrigger value="staff" className="gap-2">
              <Users className="w-4 h-4" /> Staff Management
            </TabsTrigger>
          </TabsList>

          <TabsContent value="roles">
            <RolesTab />
          </TabsContent>

          <TabsContent value="staff">
            <StaffTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function RolesTab() {
  const [showForm, setShowForm] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    vibelink.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => vibelink.entities.Role.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => vibelink.entities.Role.create(data),
    onSuccess: (created, data) => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setShowForm(false);
      setEditingRole(null);
      toast.success('Role created successfully');
      auditLog({ action: 'Role Created', category: 'user_management', level: 'info', details: `Created role "${data.name}" with ${data.permissions?.length || 0} permissions`, entity_type: 'Role', entity_name: data.name }, currentUser);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => vibelink.entities.Role.update(id, data),
    onSuccess: (updated, { id, data }) => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setShowForm(false);
      const before = editingRole;
      setEditingRole(null);
      toast.success('Role updated successfully');
      auditLog({ action: 'Role Updated', category: 'user_management', level: 'info', details: `Updated role "${data.name || before?.name}"`, entity_type: 'Role', entity_id: id, entity_name: data.name || before?.name, changes: { before: { name: before?.name, permissions: before?.permissions }, after: { name: data.name, permissions: data.permissions } } }, currentUser);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (role) => vibelink.entities.Role.delete(role.id),
    onSuccess: (_, role) => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role deleted successfully');
      auditLog({ action: 'Role Deleted', category: 'user_management', level: 'warning', details: `Deleted role "${role.name}"`, entity_type: 'Role', entity_id: role.id, entity_name: role.name }, currentUser);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Roles & Permissions</h3>
          <p className="text-sm text-slate-500">Define roles to control staff access levels</p>
        </div>
        <Button onClick={() => { setEditingRole(null); setShowForm(true); }} className="bg-indigo-600 hover:bg-indigo-700">
          <Plus className="w-4 h-4 mr-2" />
          Create Role
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-indigo-600">{roles.length}</p>
              <p className="text-sm text-slate-500">Total Roles</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-emerald-600">{roles.filter(r => r.status === 'active').length}</p>
              <p className="text-sm text-slate-500">Active</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-purple-600">{roles.filter(r => r.is_system).length}</p>
              <p className="text-sm text-slate-500">System Roles</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">{roles.filter(r => !r.is_system).length}</p>
              <p className="text-sm text-slate-500">Custom Roles</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2].map(i => <div key={i} className="h-48 bg-white rounded-2xl animate-pulse" />)}
        </div>
      ) : roles.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="No roles defined"
          description="Create roles to manage user permissions"
          actionLabel="Create Role"
          onAction={() => setShowForm(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {roles.map((role, index) => (
            <motion.div
              key={role.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-indigo-50">
                        <Shield className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{role.name}</CardTitle>
                        <div className="flex gap-2 mt-1">
                          <StatusBadge status={role.status} />
                          {role.is_system && (
                            <Badge variant="outline" className="text-xs">System</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    {!role.is_system && (
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => { setEditingRole(role); setShowForm(true); }}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="text-rose-500" 
                          onClick={() => {
                            if (confirm('Delete this role?')) {
                              deleteMutation.mutate(role);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {role.description && (
                    <p className="text-sm text-slate-600 mb-3">{role.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {role.permissions?.slice(0, 6).map(p => (
                      <span key={p} className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-full">
                        {p.split('.').pop()}
                      </span>
                    ))}
                    {(role.permissions?.length || 0) > 6 && (
                      <span className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded-full font-medium">
                        +{role.permissions.length - 6} more
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <RoleFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        role={editingRole}
        onSubmit={(data) => {
          if (editingRole) {
            updateMutation.mutate({ id: editingRole.id, data });
          } else {
            createMutation.mutate(data);
          }
        }}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}

function StaffTab() {
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    vibelink.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => vibelink.entities.User.list(),
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => vibelink.entities.Role.list(),
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }) => vibelink.entities.User.update(id, data),
    onSuccess: (_, { id, data }) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      const target = selectedUser;
      const newRole = roles.find(r => r.id === data.staff_role_id);
      const oldRole = roles.find(r => r.id === target?.staff_role_id);
      setShowEditDialog(false);
      setSelectedUser(null);
      toast.success('Staff member updated successfully');
      auditLog({ action: 'Staff Role Changed', category: 'user_management', level: 'info', details: `Changed role of "${target?.full_name || target?.email}" from "${oldRole?.name || 'None'}" to "${newRole?.name || 'None'}"`, entity_type: 'User', entity_id: id, entity_name: target?.full_name || target?.email, changes: { before: { staff_role_id: target?.staff_role_id, role_name: oldRole?.name }, after: { staff_role_id: data.staff_role_id, role_name: newRole?.name } } }, currentUser);
    },
  });

  const filteredUsers = users.filter(user =>
    user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getUserRole = (user) => {
    if (user.staff_role_id) {
      return roles.find(r => r.id === user.staff_role_id);
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Staff Management</h3>
          <p className="text-sm text-slate-500">{users.length} team members</p>
        </div>
        <Button onClick={() => setShowInviteDialog(true)} className="bg-indigo-600 hover:bg-indigo-700">
          <UserPlus className="w-4 h-4 mr-2" />
          Invite Staff
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                <Users className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{users.length}</p>
                <p className="text-xs text-slate-500">Total Staff</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Shield className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{users.filter(u => u.role === 'admin').length}</p>
                <p className="text-xs text-slate-500">Admins</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{users.filter(u => u.role === 'user').length}</p>
                <p className="text-xs text-slate-500">Staff Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                <Shield className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{roles.length}</p>
                <p className="text-xs text-slate-500">Roles</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search staff..."
          className="pl-10 bg-white"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff Member</TableHead>
                <TableHead>System Role</TableHead>
                <TableHead>Staff Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <div className="animate-pulse text-slate-400">Loading...</div>
                  </TableCell>
                </TableRow>
              ) : filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                    No staff members found
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((user) => {
                  const staffRole = getUserRole(user);
                  return (
                    <TableRow key={user.id} className="hover:bg-slate-50">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white">
                              {user.full_name?.charAt(0).toUpperCase() || 'U'}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-slate-900">{user.full_name || 'Unnamed'}</p>
                            <p className="text-sm text-slate-500">{user.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.role === 'admin' ? 'default' : 'outline'} className={user.role === 'admin' ? 'bg-indigo-600' : ''}>
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {staffRole ? (
                          <div className="flex items-center gap-2">
                            <Shield className="w-4 h-4 text-indigo-500" />
                            <span className="text-sm font-medium text-slate-700">{staffRole.name}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-slate-400 italic">No role assigned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-slate-500">
                          {user.created_date ? format(new Date(user.created_date), 'MMM d, yyyy') : '-'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-white">
                            <DropdownMenuItem onClick={() => { setSelectedUser(user); setShowEditDialog(true); }}>
                              <Edit2 className="w-4 h-4 mr-2" />
                              Edit Role
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <InviteStaffDialog
        open={showInviteDialog}
        onOpenChange={setShowInviteDialog}
        roles={roles}
      />

      <EditRoleDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        user={selectedUser}
        roles={roles}
        onSubmit={(data) => updateUserMutation.mutate({ id: selectedUser.id, data })}
        isLoading={updateUserMutation.isPending}
      />
    </div>
  );
}

function RoleFormDialog({ open, onOpenChange, role, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({ name: '', description: '', permissions: [], status: 'active' });

  React.useEffect(() => {
    if (role) {
      setFormData({
        name: role.name || '',
        description: role.description || '',
        permissions: role.permissions || [],
        status: role.status || 'active',
      });
    } else {
      setFormData({ name: '', description: '', permissions: [], status: 'active' });
    }
  }, [role, open]);

  const togglePermission = (code) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(code)
        ? prev.permissions.filter(p => p !== code)
        : [...prev.permissions, code]
    }));
  };

  const toggleGroup = (group) => {
    const groupCodes = group.permissions.map(p => p.code);
    const allSelected = groupCodes.every(c => formData.permissions.includes(c));
    setFormData(prev => ({
      ...prev,
      permissions: allSelected
        ? prev.permissions.filter(p => !groupCodes.includes(p))
        : [...new Set([...prev.permissions, ...groupCodes])]
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role ? 'Edit Role' : 'Create Role'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(formData); }} className="space-y-6 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Role Name *</Label>
              <Input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} placeholder="e.g., Support Agent" required />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({...formData, status: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Description</Label>
              <Textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={2} placeholder="Brief description of this role" />
            </div>
          </div>

          <div className="space-y-4">
            <Label>Permissions</Label>
            <div className="space-y-4 max-h-96 overflow-y-auto p-1">
              {PERMISSIONS.map(group => (
                <div key={group.group} className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Checkbox
                      checked={group.permissions.every(p => formData.permissions.includes(p.code))}
                      onCheckedChange={() => toggleGroup(group)}
                    />
                    <span className="font-semibold text-slate-900">{group.group}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 ml-6">
                    {group.permissions.map(p => (
                      <div key={p.code} className="flex items-center gap-2">
                        <Checkbox
                          checked={formData.permissions.includes(p.code)}
                          onCheckedChange={() => togglePermission(p.code)}
                        />
                        <span className="text-sm text-slate-600">{p.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700">
              {isLoading ? 'Saving...' : role ? 'Update Role' : 'Create Role'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InviteStaffDialog({ open, onOpenChange, roles }) {
  const [email, setEmail] = useState('');
  const [systemRole, setSystemRole] = useState('user');
  const [staffRoleId, setStaffRoleId] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [result, setResult] = useState(null);

  const handleInvite = async (e) => {
    e.preventDefault();
    setIsInviting(true);
    setResult(null);
    
    try {
      const currentUser = await vibelink.auth.me();
      await vibelink.users.inviteUser(email, systemRole);
      setResult({ success: true, message: `Invitation sent to ${email}` });
      toast.success('Invitation sent successfully');
      auditLog({ action: 'Staff Invited', category: 'user_management', level: 'info', details: `Invited "${email}" as ${systemRole}`, entity_type: 'User', entity_name: email }, currentUser);
      setEmail('');
      setSystemRole('user');
      setStaffRoleId('');
    } catch (error) {
      setResult({ success: false, message: error.message || 'Failed to send invitation' });
      toast.error('Failed to send invitation');
    } finally {
      setIsInviting(false);
    }
  };

  React.useEffect(() => {
    if (!open) {
      setEmail('');
      setSystemRole('user');
      setStaffRoleId('');
      setResult(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Staff Member</DialogTitle>
          <DialogDescription>
            Send an invitation email to add a new team member
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleInvite} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>Email Address *</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@company.com"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>System Role *</Label>
            <Select value={systemRole} onValueChange={setSystemRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">Staff User</SelectItem>
                <SelectItem value="admin">Administrator</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              Admins have full system access. Staff users are restricted by their assigned role.
            </p>
          </div>

          {result && (
            <div className={`p-3 rounded-lg flex items-center gap-2 ${
              result.success ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            }`}>
              {result.success ? <Check className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              <span className="text-sm">{result.message}</span>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isInviting} className="bg-indigo-600 hover:bg-indigo-700">
              {isInviting ? 'Sending...' : 'Send Invitation'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditRoleDialog({ open, onOpenChange, user, roles, onSubmit, isLoading }) {
  const [staffRoleId, setStaffRoleId] = useState('');

  React.useEffect(() => {
    if (user) {
      setStaffRoleId(user.staff_role_id || '');
    }
  }, [user, open]);

  if (!user) return null;

  const selectedRole = roles.find(r => r.id === staffRoleId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Staff Role</DialogTitle>
          <DialogDescription>
            Assign a role to control what {user.full_name || user.email} can access
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
            <Avatar>
              <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white">
                {user.full_name?.charAt(0).toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium text-slate-900">{user.full_name || 'Unnamed'}</p>
              <p className="text-sm text-slate-500">{user.email}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Staff Role</Label>
            <Select value={staffRoleId} onValueChange={setStaffRoleId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>No Role (Full Access if Admin)</SelectItem>
                {roles.filter(r => r.status === 'active').map(role => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedRole && (
            <div className="p-3 bg-indigo-50 rounded-lg">
              <p className="text-sm font-medium text-indigo-900 mb-2">Permissions:</p>
              <div className="flex flex-wrap gap-1">
                {selectedRole.permissions?.slice(0, 8).map(p => (
                  <span key={p} className="text-xs px-2 py-1 bg-white text-indigo-700 rounded-full">
                    {p}
                  </span>
                ))}
                {(selectedRole.permissions?.length || 0) > 8 && (
                  <span className="text-xs px-2 py-1 bg-white text-indigo-700 rounded-full">
                    +{selectedRole.permissions.length - 8} more
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => onSubmit({ staff_role_id: staffRoleId || null })} 
              disabled={isLoading} 
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}