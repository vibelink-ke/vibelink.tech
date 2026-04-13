import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { 
  AlertTriangle, 
  Plus, 
  Edit2,
  Eye,
  Clock,
  CheckCircle,
  XCircle,
  Zap,
  MapPin,
  Users
} from 'lucide-react';
import { format } from 'date-fns';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

const SEVERITY_CONFIG = {
  low: { icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  medium: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  high: { icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  critical: { icon: Zap, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200' },
};

const STATUS_CONFIG = {
  investigating: { label: 'Investigating', color: 'bg-amber-100 text-amber-700' },
  identified: { label: 'Identified', color: 'bg-blue-100 text-blue-700' },
  monitoring: { label: 'Monitoring', color: 'bg-purple-100 text-purple-700' },
  resolved: { label: 'Resolved', color: 'bg-emerald-100 text-emerald-700' },
};

export default function Outages() {
  const [showForm, setShowForm] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [editingOutage, setEditingOutage] = useState(null);
  const [selectedOutage, setSelectedOutage] = useState(null);
  const queryClient = useQueryClient();

  const { data: outages = [], isLoading } = useQuery({
    queryKey: ['outages'],
    queryFn: () => vibelink.entities.Outage.list('-created_date'),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => vibelink.entities.Customer.list(),
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const outage = await vibelink.entities.Outage.create(data);
      
      // Notify customers if requested
      if (data.notify_customers) {
        await notifyCustomers(outage, customers, data.notify_via_email, data.notify_via_sms);
      }
      
      return outage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['outages']);
      setShowForm(false);
      setEditingOutage(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data, sendUpdate }) => {
      const outage = await vibelink.entities.Outage.update(id, data);
      
      // Send update notification if requested
      if (sendUpdate && data.notify_customers) {
        await notifyCustomers(outage, customers, data.notify_via_email, data.notify_via_sms, true);
      }
      
      return outage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['outages']);
      setShowForm(false);
      setEditingOutage(null);
      setShowDetails(false);
    },
  });

  const notifyCustomers = async (outage, customers, viaEmail, viaSMS, isUpdate = false) => {
    const activeCustomers = customers.filter(c => c.status === 'active');
    let notifiedCount = 0;

    const messagePrefix = isUpdate ? 'Update: ' : '';
    const statusText = STATUS_CONFIG[outage.status]?.label || outage.status;
    
    for (const customer of activeCustomers) {
      try {
        // Send email
        if (viaEmail && customer.email) {
          const emailBody = `
            <h2>${messagePrefix}Service ${outage.type === 'planned' ? 'Maintenance' : 'Outage'} Notification</h2>
            <p><strong>Status:</strong> ${statusText}</p>
            <p><strong>Severity:</strong> ${outage.severity.toUpperCase()}</p>
            <h3>${outage.title}</h3>
            <p>${outage.description}</p>
            ${outage.affected_areas?.length ? `<p><strong>Affected Areas:</strong> ${outage.affected_areas.join(', ')}</p>` : ''}
            ${outage.affected_services?.length ? `<p><strong>Affected Services:</strong> ${outage.affected_services.join(', ')}</p>` : ''}
            ${outage.estimated_resolution ? `<p><strong>Estimated Resolution:</strong> ${format(new Date(outage.estimated_resolution), 'MMM d, yyyy HH:mm')}</p>` : ''}
            <p>We apologize for any inconvenience and are working to resolve this as quickly as possible.</p>
          `;
          
          await vibelink.integrations.Core.SendEmail({
            to: customer.email,
            subject: `${messagePrefix}Service ${outage.type === 'planned' ? 'Maintenance' : 'Outage'}: ${outage.title}`,
            body: emailBody,
          });
        }

        // Send SMS
        if (viaSMS && customer.phone) {
          const smsMessage = `${messagePrefix}Service ${outage.type === 'planned' ? 'Maintenance' : 'Outage'} - ${outage.title}. Status: ${statusText}. ${outage.description.substring(0, 100)}...`;
          
          await vibelink.integrations.Core.SendEmail({
            to: customer.email,
            subject: 'SMS Notification',
            body: `SMS would be sent to ${customer.phone}: ${smsMessage}`,
          });
        }

        notifiedCount++;
      } catch (error) {
        console.error(`Failed to notify customer ${customer.id}:`, error);
      }
    }

    // Update notification count
    await vibelink.entities.Outage.update(outage.id, {
      customers_notified: notifiedCount,
    });
  };

  const activeOutages = outages.filter(o => o.status !== 'resolved');
  const resolvedOutages = outages.filter(o => o.status === 'resolved');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Service Outages"
          subtitle="Monitor and manage service disruptions"
          actionLabel="Report Outage"
          actionIcon={Plus}
          onAction={() => { setEditingOutage(null); setShowForm(true); }}
        />

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-rose-50 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-rose-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-rose-600">{activeOutages.length}</p>
                  <p className="text-xs text-slate-500">Active Outages</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-600">{resolvedOutages.length}</p>
                  <p className="text-xs text-slate-500">Resolved</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-600">
                    {activeOutages.filter(o => o.severity === 'critical' || o.severity === 'high').length}
                  </p>
                  <p className="text-xs text-slate-500">High Priority</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <Users className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-indigo-600">
                    {outages.reduce((sum, o) => sum + (o.customers_notified || 0), 0)}
                  </p>
                  <p className="text-xs text-slate-500">Notifications Sent</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Active Outages */}
        {activeOutages.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Active Outages</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeOutages.map((outage, index) => {
                const config = SEVERITY_CONFIG[outage.severity] || SEVERITY_CONFIG.medium;
                const Icon = config.icon;
                return (
                  <motion.div
                    key={outage.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <Card className={`border-l-4 ${config.border} hover:shadow-lg transition-shadow`}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-3 flex-1">
                            <div className={`p-2 rounded-lg ${config.bg}`}>
                              <Icon className={`w-5 h-5 ${config.color}`} />
                            </div>
                            <div className="flex-1">
                              <CardTitle className="text-base mb-1">{outage.title}</CardTitle>
                              <div className="flex flex-wrap gap-2">
                                <Badge className={STATUS_CONFIG[outage.status].color}>
                                  {STATUS_CONFIG[outage.status].label}
                                </Badge>
                                <Badge variant="outline" className="capitalize">
                                  {outage.type}
                                </Badge>
                                {outage.show_on_portal && (
                                  <Badge variant="outline" className="text-indigo-600">
                                    <Eye className="w-3 h-3 mr-1" />
                                    Visible
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 line-clamp-2">{outage.description}</p>
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>
                            {outage.customers_notified || 0} customers notified
                          </span>
                          <div className="flex gap-2">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => { setSelectedOutage(outage); setShowDetails(true); }}
                            >
                              View Details
                            </Button>
                            <Button 
                              size="sm"
                              onClick={() => { setEditingOutage(outage); setShowForm(true); }}
                            >
                              Update
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Resolved Outages */}
        <Card>
          <CardHeader>
            <CardTitle>Outage History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Reported</TableHead>
                  <TableHead>Resolved</TableHead>
                  <TableHead>Notified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <div className="animate-pulse text-slate-400">Loading...</div>
                    </TableCell>
                  </TableRow>
                ) : outages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <EmptyState
                        icon={AlertTriangle}
                        title="No outages reported"
                        description="Report service disruptions to notify customers"
                        actionLabel="Report Outage"
                        onAction={() => setShowForm(true)}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  outages.map((outage) => (
                    <TableRow 
                      key={outage.id} 
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => { setSelectedOutage(outage); setShowDetails(true); }}
                    >
                      <TableCell>
                        <div>
                          <p className="font-medium text-slate-900 dark:text-slate-50">{outage.title}</p>
                          <p className="text-xs text-slate-500 line-clamp-1">{outage.description}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">{outage.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">{outage.severity}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {format(new Date(outage.created_date), 'MMM d, HH:mm')}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {outage.actual_resolution ? format(new Date(outage.actual_resolution), 'MMM d, HH:mm') : '-'}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {outage.customers_notified || 0}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <OutageFormDialog
          open={showForm}
          onOpenChange={setShowForm}
          outage={editingOutage}
          onSubmit={(data, sendUpdate) => {
            if (editingOutage) {
              updateMutation.mutate({ id: editingOutage.id, data, sendUpdate });
            } else {
              createMutation.mutate(data);
            }
          }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />

        <OutageDetailsSheet
          open={showDetails}
          onOpenChange={setShowDetails}
          outage={selectedOutage}
          onEdit={(outage) => {
            setEditingOutage(outage);
            setShowDetails(false);
            setShowForm(true);
          }}
        />
      </div>
    </div>
  );
}

function OutageFormDialog({ open, onOpenChange, outage, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'unplanned',
    severity: 'medium',
    status: 'investigating',
    affected_areas: [],
    affected_services: [],
    estimated_resolution: '',
    notify_customers: true,
    notify_via_email: true,
    notify_via_sms: false,
    show_on_portal: true,
  });
  const [sendUpdate, setSendUpdate] = useState(false);
  const [areaInput, setAreaInput] = useState('');
  const [serviceInput, setServiceInput] = useState('');

  React.useEffect(() => {
    if (outage) {
      setFormData({
        title: outage.title || '',
        description: outage.description || '',
        type: outage.type || 'unplanned',
        severity: outage.severity || 'medium',
        status: outage.status || 'investigating',
        affected_areas: outage.affected_areas || [],
        affected_services: outage.affected_services || [],
        estimated_resolution: outage.estimated_resolution || '',
        notify_customers: true,
        notify_via_email: true,
        notify_via_sms: false,
        show_on_portal: outage.show_on_portal !== false,
        actual_resolution: outage.status === 'resolved' ? new Date().toISOString() : null,
      });
      setSendUpdate(false);
    } else {
      setFormData({
        title: '',
        description: '',
        type: 'unplanned',
        severity: 'medium',
        status: 'investigating',
        affected_areas: [],
        affected_services: [],
        estimated_resolution: '',
        notify_customers: true,
        notify_via_email: true,
        notify_via_sms: false,
        show_on_portal: true,
      });
    }
  }, [outage, open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData, sendUpdate);
  };

  const addArea = () => {
    if (areaInput.trim()) {
      setFormData(prev => ({
        ...prev,
        affected_areas: [...prev.affected_areas, areaInput.trim()]
      }));
      setAreaInput('');
    }
  };

  const addService = () => {
    if (serviceInput.trim()) {
      setFormData(prev => ({
        ...prev,
        affected_services: [...prev.affected_services, serviceInput.trim()]
      }));
      setServiceInput('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{outage ? 'Update Outage' : 'Report Service Outage'}</DialogTitle>
          <DialogDescription>
            {outage ? 'Update outage details and notify customers of changes' : 'Report a service disruption and notify affected customers'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <Label>Title *</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Brief description of the issue"
                required
              />
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Description *</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Detailed information about the outage"
                rows={3}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unplanned">Unplanned Outage</SelectItem>
                  <SelectItem value="planned">Planned Maintenance</SelectItem>
                  <SelectItem value="emergency">Emergency</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Severity</Label>
              <Select value={formData.severity} onValueChange={(value) => setFormData({ ...formData, severity: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="investigating">Investigating</SelectItem>
                  <SelectItem value="identified">Identified</SelectItem>
                  <SelectItem value="monitoring">Monitoring</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Estimated Resolution</Label>
              <Input
                type="datetime-local"
                value={formData.estimated_resolution ? format(new Date(formData.estimated_resolution), "yyyy-MM-dd'T'HH:mm") : ''}
                onChange={(e) => setFormData({ ...formData, estimated_resolution: e.target.value ? new Date(e.target.value).toISOString() : '' })}
              />
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Affected Areas</Label>
              <div className="flex gap-2">
                <Input
                  value={areaInput}
                  onChange={(e) => setAreaInput(e.target.value)}
                  placeholder="e.g., Downtown, North District"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addArea())}
                />
                <Button type="button" onClick={addArea}>Add</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.affected_areas.map((area, i) => (
                  <Badge key={i} variant="secondary">
                    {area}
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({
                        ...prev,
                        affected_areas: prev.affected_areas.filter((_, index) => index !== i)
                      }))}
                      className="ml-2"
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Affected Services</Label>
              <div className="flex gap-2">
                <Input
                  value={serviceInput}
                  onChange={(e) => setServiceInput(e.target.value)}
                  placeholder="e.g., Internet, Phone, IPTV"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addService())}
                />
                <Button type="button" onClick={addService}>Add</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.affected_services.map((service, i) => (
                  <Badge key={i} variant="secondary">
                    {service}
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({
                        ...prev,
                        affected_services: prev.affected_services.filter((_, index) => index !== i)
                      }))}
                      className="ml-2"
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label>Display on Customer Portal</Label>
              <Switch
                checked={formData.show_on_portal}
                onCheckedChange={(checked) => setFormData({ ...formData, show_on_portal: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>Notify Customers via Email</Label>
              <Switch
                checked={formData.notify_via_email}
                onCheckedChange={(checked) => setFormData({ ...formData, notify_via_email: checked, notify_customers: checked || formData.notify_via_sms })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>Notify Customers via SMS</Label>
              <Switch
                checked={formData.notify_via_sms}
                onCheckedChange={(checked) => setFormData({ ...formData, notify_via_sms: checked, notify_customers: checked || formData.notify_via_email })}
              />
            </div>

            {outage && (
              <div className="flex items-center justify-between">
                <Label>Send Update Notification</Label>
                <Switch
                  checked={sendUpdate}
                  onCheckedChange={setSendUpdate}
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700">
              {isLoading ? 'Saving...' : outage ? 'Update Outage' : 'Report Outage'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OutageDetailsSheet({ open, onOpenChange, outage, onEdit }) {
  if (!outage) return null;

  const config = SEVERITY_CONFIG[outage.severity] || SEVERITY_CONFIG.medium;
  const Icon = config.icon;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Outage Details</SheetTitle>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          <div className={`flex items-start gap-3 p-4 rounded-lg ${config.bg}`}>
            <Icon className={`w-6 h-6 ${config.color} mt-1`} />
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-1">{outage.title}</h3>
              <div className="flex flex-wrap gap-2">
                <Badge className={STATUS_CONFIG[outage.status].color}>
                  {STATUS_CONFIG[outage.status].label}
                </Badge>
                <Badge variant="outline" className="capitalize">{outage.type}</Badge>
                <Badge variant="outline" className="capitalize">{outage.severity}</Badge>
              </div>
            </div>
          </div>

          <div>
            <Label className="text-sm text-slate-500">Description</Label>
            <p className="mt-1 text-slate-700 dark:text-slate-300">{outage.description}</p>
          </div>

          {outage.affected_areas?.length > 0 && (
            <div>
              <Label className="text-sm text-slate-500">Affected Areas</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {outage.affected_areas.map((area, i) => (
                  <Badge key={i} variant="secondary">
                    <MapPin className="w-3 h-3 mr-1" />
                    {area}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {outage.affected_services?.length > 0 && (
            <div>
              <Label className="text-sm text-slate-500">Affected Services</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {outage.affected_services.map((service, i) => (
                  <Badge key={i} variant="secondary">{service}</Badge>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm text-slate-500">Reported</Label>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                {format(new Date(outage.created_date), 'MMM d, yyyy HH:mm')}
              </p>
            </div>

            {outage.estimated_resolution && (
              <div>
                <Label className="text-sm text-slate-500">Est. Resolution</Label>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                  {format(new Date(outage.estimated_resolution), 'MMM d, yyyy HH:mm')}
                </p>
              </div>
            )}

            {outage.actual_resolution && (
              <div>
                <Label className="text-sm text-slate-500">Resolved</Label>
                <p className="text-sm font-medium text-emerald-600">
                  {format(new Date(outage.actual_resolution), 'MMM d, yyyy HH:mm')}
                </p>
              </div>
            )}

            <div>
              <Label className="text-sm text-slate-500">Customers Notified</Label>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-50">{outage.customers_notified || 0}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm">
              {outage.show_on_portal ? (
                <>
                  <Eye className="w-4 h-4 text-indigo-500" />
                  <span className="text-slate-700 dark:text-slate-300">Visible on customer portal</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-500">Hidden from customer portal</span>
                </>
              )}
            </div>
            {outage.reported_by && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Users className="w-4 h-4" />
                <span>Reported by {outage.reported_by}</span>
              </div>
            )}
          </div>

          <Button onClick={() => onEdit(outage)} className="w-full">
            <Edit2 className="w-4 h-4 mr-2" />
            Update Outage
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}