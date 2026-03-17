import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { Wifi, Edit2, Plus, CheckCircle, AlertTriangle, Save, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { format, addMonths, differenceInDays } from 'date-fns';
import { toast } from 'sonner';
import IPAddressSelector from '@/components/customer/IPAddressSelector';

export default function CustomerServicesTab({ customer, onCustomerUpdated }) {
  const queryClient = useQueryClient();
  const [showProvisionDialog, setShowProvisionDialog] = useState(false);
  const [editingService, setEditingService] = useState(null);

  const { data: services = [] } = useQuery({
    queryKey: ['customer-services', customer.id],
    queryFn: () => vibelink.entities.CustomerService.filter({ customer_id: customer.id }, '-created_date'),
    enabled: !!customer.id,
  });

  const { data: allPlans = [] } = useQuery({
    queryKey: ['plans'],
    queryFn: () => vibelink.entities.ServicePlan.filter({ status: 'active' }),
  });

  const { data: mikrotiks = [] } = useQuery({
    queryKey: ['mikrotiks'],
    queryFn: () => vibelink.entities.Mikrotik.list(),
  });

  const getExpiryStatus = (service) => {
    if (!service.last_payment_date) return null;
    const expiryDate = addMonths(new Date(service.last_payment_date), 1);
    const daysUntilExpiry = differenceInDays(expiryDate, new Date());
    if (daysUntilExpiry < 0) return { label: 'Expired', color: 'bg-rose-100 text-rose-800', icon: AlertTriangle };
    if (daysUntilExpiry <= 5) return { label: `Expires in ${daysUntilExpiry}d`, color: 'bg-amber-100 text-amber-800', icon: AlertTriangle };
    return { label: `${daysUntilExpiry} days left`, color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle };
  };

  return (
    <div className="space-y-6">
      {/* Add Service Button */}
      <div className="flex justify-end">
        <Button onClick={() => { setEditingService(null); setShowProvisionDialog(true); }} className="bg-indigo-600 hover:bg-indigo-700">
          <Plus className="w-4 h-4 mr-2" /> Add Service
        </Button>
      </div>

      {/* Services List */}
      {services.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardContent className="text-center py-12">
              <Wifi className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 mb-4">No services assigned to this customer</p>
              <Button onClick={() => { setEditingService(null); setShowProvisionDialog(true); }} className="bg-indigo-600 hover:bg-indigo-700">
                <Plus className="w-4 h-4 mr-2" /> Add First Service
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        services.map((service, idx) => (
          <ServiceCard
            key={service.id}
            service={service}
            allPlans={allPlans}
            onEdit={() => { setEditingService(service); setShowProvisionDialog(true); }}
            onDelete={async () => {
              await vibelink.entities.CustomerService.delete(service.id);
              queryClient.invalidateQueries(['customer-services', customer.id]);
              toast.success('Service removed');
            }}
            getExpiryStatus={getExpiryStatus}
            delay={idx * 0.1}
          />
        ))
      )}

      {/* Account Details */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card>
          <CardHeader><CardTitle>Account Details</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 mb-1">MikroTik Router</p>
                <p className="font-medium text-slate-900">{customer.mikrotik_name || 'Not assigned'}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 mb-1">IP Address</p>
                <p className="font-mono text-sm font-medium text-slate-900">{customer.ip_address || 'Not assigned'}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                  MAC Address
                  <span className="text-slate-300 font-normal">(auto)</span>
                </p>
                <p className="font-mono text-sm font-medium text-slate-900">{customer.mac_address || <span className="text-slate-400 italic text-xs">Awaiting first connection</span>}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 mb-1">Monthly Rate</p>
                <p className="font-semibold text-slate-900">KES {customer.monthly_rate?.toLocaleString() || '0'}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg col-span-2">
                <p className="text-xs text-slate-500 mb-1">Account Balance</p>
                <p className={`font-semibold ${(customer.balance || 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  KES {Math.abs(customer.balance || 0).toLocaleString()}
                  {(customer.balance || 0) > 0 ? ' (overdue)' : ' (credit)'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Add/Edit Service Dialog */}
      <AddServiceDialog
        open={showProvisionDialog}
        onOpenChange={setShowProvisionDialog}
        customer={customer}
        service={editingService}
        plans={allPlans}
        mikrotiks={mikrotiks}
        onSuccess={() => {
          queryClient.invalidateQueries(['customer-services', customer.id]);
          if (onCustomerUpdated) onCustomerUpdated();
        }}
      />
    </div>
  );
}

function AddServiceDialog({ open, onOpenChange, customer, service, plans, mikrotiks, onSuccess }) {
  const [formData, setFormData] = useState({
    plan_id: '',
    installation_date: new Date().toISOString().split('T')[0],
    billing_cycle_day: 1,
    mac_address: '',
    ip_address: '',
    mikrotik_id: '',
    mikrotik_name: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (open && service) {
      setFormData({
        plan_id: service.plan_id,
        installation_date: service.installation_date || '',
        billing_cycle_day: service.billing_cycle_day || 1,
        mac_address: service.mac_address || '',
        ip_address: service.ip_address || '',
        mikrotik_id: service.mikrotik_id || '',
        mikrotik_name: service.mikrotik_name || '',
        notes: service.notes || '',
      });
    } else if (open && !service) {
      setFormData({
        plan_id: '',
        installation_date: new Date().toISOString().split('T')[0],
        billing_cycle_day: 1,
        mac_address: '',
        ip_address: '',
        mikrotik_id: '',
        mikrotik_name: '',
        notes: '',
      });
    }
  }, [open, service]);

  const handleSave = async () => {
    if (!formData.plan_id) { toast.error('Please select a plan'); return; }
    setLoading(true);
    try {
      const plan = plans.find(p => p.id === formData.plan_id);
      
      if (service) {
        // Edit existing service
        await vibelink.entities.CustomerService.update(service.id, {
          plan_id: formData.plan_id,
          plan_name: plan.name,
          monthly_rate: plan.monthly_price,
          installation_date: formData.installation_date,
          billing_cycle_day: parseInt(formData.billing_cycle_day),
          mac_address: formData.mac_address,
          ip_address: formData.ip_address,
          mikrotik_id: formData.mikrotik_id || null,
          mikrotik_name: formData.mikrotik_name || null,
          notes: formData.notes,
        });
        toast.success('Service updated successfully!');
      } else {
        // Create new service
        await vibelink.entities.CustomerService.create({
          customer_id: customer.id,
          customer_name: customer.full_name,
          plan_id: formData.plan_id,
          plan_name: plan.name,
          monthly_rate: plan.monthly_price,
          installation_date: formData.installation_date,
          billing_cycle_day: parseInt(formData.billing_cycle_day),
          mac_address: formData.mac_address,
          ip_address: formData.ip_address,
          mikrotik_id: formData.mikrotik_id || null,
          mikrotik_name: formData.mikrotik_name || null,
          status: 'active',
          notes: formData.notes,
        });

        await vibelink.entities.SystemLog.create({
          action: 'service_provisioned',
          category: 'customer',
          level: 'info',
          entity_type: 'CustomerService',
          entity_id: customer.id,
          entity_name: customer.full_name,
          details: `Service added: ${plan.name} for ${customer.full_name}`,
        });
        toast.success('Service added successfully!');
      }

      onSuccess();
      onOpenChange(false);
    } catch (err) {
      toast.error(service ? 'Update failed: ' : 'Failed to add service: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {service ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
            {service ? 'Edit Service' : 'Add Service'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="p-3 bg-indigo-50 rounded-lg text-sm text-indigo-800">
            {service ? 'Editing service for: ' : 'Adding service for: '}<strong>{customer.full_name}</strong>
          </div>

          <div className="space-y-2">
            <Label>Service Plan *</Label>
            <Select value={formData.plan_id} onValueChange={(v) => setFormData({ ...formData, plan_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select a plan" /></SelectTrigger>
              <SelectContent>
                {plans.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — KES {p.monthly_price?.toLocaleString()}/mo ({p.download_speed}/{p.upload_speed} Mbps)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>MikroTik Router</Label>
            <Select
              value={formData.mikrotik_id || "none"}
              onValueChange={(v) => {
                if (v === 'none') { setFormData({ ...formData, mikrotik_id: '', mikrotik_name: '' }); return; }
                const mt = mikrotiks.find(m => m.id === v);
                setFormData({ ...formData, mikrotik_id: v, mikrotik_name: mt?.router_name || '' });
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select router" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {mikrotiks.map(mt => (
                  <SelectItem key={mt.id} value={mt.id}>
                    {mt.router_name} — {mt.ip_address}
                    {mt.status === 'online' && <span className="ml-2 text-emerald-600">●</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Installation Date</Label>
              <Input type="date" value={formData.installation_date} onChange={(e) => setFormData({ ...formData, installation_date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Billing Day</Label>
              <Select value={String(formData.billing_cycle_day)} onValueChange={(v) => setFormData({ ...formData, billing_cycle_day: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[...Array(28)].map((_, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>Day {i + 1}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 col-span-2">
              <Label>IP Address</Label>
              <IPAddressSelector
                value={formData.ip_address}
                onChange={(v) => setFormData({ ...formData, ip_address: v })}
                excludeIds={[customer.id]}
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label className="flex items-center gap-2">
                MAC Address
                <span className="text-xs font-normal text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Auto-detected on connect</span>
              </Label>
              <Input value={formData.mac_address} onChange={(e) => setFormData({ ...formData, mac_address: e.target.value })} placeholder="Will be populated automatically" className="text-slate-500" />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700">
              {service ? <Save className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              {loading ? (service ? 'Saving...' : 'Adding...') : (service ? 'Save Changes' : 'Add Service')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ServiceCard({ service, allPlans, onEdit, onDelete, getExpiryStatus, delay }) {
  const plan = allPlans.find(p => p.id === service.plan_id);
  const expiryStatus = getExpiryStatus(service);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <CardTitle>{plan?.name || 'Unknown Plan'}</CardTitle>
              <p className="text-sm text-slate-500 mt-1">{plan?.description}</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={onEdit}>
                <Edit2 className="w-4 h-4 mr-1" /> Edit
              </Button>
              <Button size="sm" variant="destructive" onClick={onDelete}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Status badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={service.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}>
                {service.status}
              </Badge>
              {expiryStatus && (
                <Badge className={expiryStatus.color}>
                  <expiryStatus.icon className="w-3 h-3 mr-1" />
                  {expiryStatus.label}
                </Badge>
              )}
            </div>

            {/* Speed / Data Stats */}
            {plan && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 bg-indigo-50 rounded-lg text-center">
                  <p className="text-xs text-indigo-600 font-medium mb-1">Download</p>
                  <p className="text-lg font-bold text-indigo-900">{plan.download_speed} Mbps</p>
                </div>
                <div className="p-3 bg-purple-50 rounded-lg text-center">
                  <p className="text-xs text-purple-600 font-medium mb-1">Upload</p>
                  <p className="text-lg font-bold text-purple-900">{plan.upload_speed} Mbps</p>
                </div>
                <div className="p-3 bg-emerald-50 rounded-lg text-center">
                  <p className="text-xs text-emerald-600 font-medium mb-1">Data Cap</p>
                  <p className="text-lg font-bold text-emerald-900">{plan.data_cap > 0 ? `${plan.data_cap} GB` : 'Unlimited'}</p>
                </div>
                <div className="p-3 bg-amber-50 rounded-lg text-center">
                  <p className="text-xs text-amber-600 font-medium mb-1">Monthly</p>
                  <p className="text-lg font-bold text-amber-900">KES {plan.monthly_price?.toLocaleString()}</p>
                </div>
              </div>
            )}

            {/* Key Dates */}
            <Separator />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500 mb-1">Installation</p>
                <p className="font-medium">{service.installation_date ? format(new Date(service.installation_date), 'MMM d') : 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Last Payment</p>
                <p className="font-medium">{service.last_payment_date ? format(new Date(service.last_payment_date), 'MMM d') : 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Billing Day</p>
                <p className="font-medium">{service.billing_cycle_day ? `Day ${service.billing_cycle_day}` : 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Monthly Rate</p>
                <p className="font-medium">KES {service.monthly_rate?.toLocaleString() || '0'}</p>
              </div>
            </div>

            {/* Technical Info */}
            {(service.ip_address || service.mac_address || service.mikrotik_name) && (
              <>
                <Separator />
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  {service.mikrotik_name && (
                    <div className="p-2 bg-slate-50 rounded">
                      <p className="text-xs text-slate-500 mb-1">Router</p>
                      <p className="font-mono text-xs">{service.mikrotik_name}</p>
                    </div>
                  )}
                  {service.ip_address && (
                    <div className="p-2 bg-slate-50 rounded">
                      <p className="text-xs text-slate-500 mb-1">IP Address</p>
                      <p className="font-mono text-xs">{service.ip_address}</p>
                    </div>
                  )}
                  {service.mac_address && (
                    <div className="p-2 bg-slate-50 rounded">
                      <p className="text-xs text-slate-500 mb-1">MAC</p>
                      <p className="font-mono text-xs">{service.mac_address}</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}