import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { Edit2, Save, X, MapPin, Calendar, FileText, Wrench, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function CustomerInfoTab({ customer }) {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState(customer);
  const [showModifyDialog, setShowModifyDialog] = useState(false);
  const [showProvisionDialog, setShowProvisionDialog] = useState(false);
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (data) => vibelink.entities.Customer.update(customer.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['customer', customer.id]);
      setIsEditing(false);
      toast.success('Customer updated successfully');
    },
  });

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  const handleCancel = () => {
    setFormData(customer);
    setIsEditing(false);
  };

  React.useEffect(() => {
    setFormData(customer);
  }, [customer]);

  const handleModifyService = () => {
    setShowModifyDialog(true);
  };

  const handleProvision = () => {
    setShowProvisionDialog(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
         <div className="flex gap-2">
           <Button onClick={handleModifyService} variant="outline" className="border-indigo-200 text-indigo-600 hover:bg-indigo-50">
             <Wrench className="w-4 h-4 mr-2" />
             Modify Service
           </Button>
           <Button onClick={handleProvision} variant="outline" className="border-emerald-200 text-emerald-600 hover:bg-emerald-50">
             <Plus className="w-4 h-4 mr-2" />
             Provision
           </Button>
         </div>
        
        <div className="flex justify-end">
          {!isEditing ? (
            <Button onClick={() => setIsEditing(true)} className="bg-indigo-600 hover:bg-indigo-700">
              <Edit2 className="w-4 h-4 mr-2" />
              Edit Information
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleCancel}>
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={updateMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700">
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personal Information */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardHeader>
              <CardTitle>Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Full Name</Label>
                {isEditing ? (
                  <Input value={formData.full_name} onChange={(e) => setFormData({...formData, full_name: e.target.value})} />
                ) : (
                  <p className="text-slate-900 font-medium">{customer.full_name}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                {isEditing ? (
                  <Input type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} />
                ) : (
                  <p className="text-slate-900 font-medium">{customer.email}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                {isEditing ? (
                  <Input value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} />
                ) : (
                  <p className="text-slate-900 font-medium">{customer.phone}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                {isEditing ? (
                  <Select value={formData.status} onValueChange={(v) => setFormData({...formData, status: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="terminated">Terminated</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-slate-900 font-medium capitalize">{customer.status}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Service Address */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="w-5 h-5" />
                Service Address
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Address</Label>
                {isEditing ? (
                  <Textarea value={formData.address} onChange={(e) => setFormData({...formData, address: e.target.value})} rows={2} />
                ) : (
                  <p className="text-slate-900 font-medium">{customer.address}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                {isEditing ? (
                  <Input value={formData.city} onChange={(e) => setFormData({...formData, city: e.target.value})} />
                ) : (
                  <p className="text-slate-900 font-medium">{customer.city || 'N/A'}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>MAC Address</Label>
                  {isEditing ? (
                    <Input value={formData.mac_address} onChange={(e) => setFormData({...formData, mac_address: e.target.value})} />
                  ) : (
                    <p className="text-slate-900 font-mono text-sm">{customer.mac_address || 'N/A'}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>IP Address</Label>
                  {isEditing ? (
                    <Input value={formData.ip_address} onChange={(e) => setFormData({...formData, ip_address: e.target.value})} />
                  ) : (
                    <p className="text-slate-900 font-mono text-sm">{customer.ip_address || 'N/A'}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Account Details */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Account Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-slate-500">Customer ID</Label>
                  <p className="text-slate-900 font-medium">{customer.customer_id}</p>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Installation Date</Label>
                  <p className="text-slate-900 font-medium">
                    {customer.installation_date ? format(new Date(customer.installation_date), 'MMM d, yyyy') : 'N/A'}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Last Payment</Label>
                  <p className="text-slate-900 font-medium">
                    {customer.last_payment_date ? format(new Date(customer.last_payment_date), 'MMM d, yyyy') : 'N/A'}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Billing Cycle</Label>
                  <p className="text-slate-900 font-medium">
                    {customer.billing_cycle_day ? `Day ${customer.billing_cycle_day}` : 'N/A'}
                  </p>
                </div>
              </div>
              {customer.referral_code && (
                <div>
                  <Label className="text-xs text-slate-500">Referral Code</Label>
                  <p className="text-slate-900 font-mono font-medium text-lg">{customer.referral_code}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Notes */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Internal Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <Textarea
                  value={formData.notes || ''}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  rows={6}
                  placeholder="Add internal notes about this customer..."
                />
              ) : (
                <p className="text-slate-600 whitespace-pre-wrap">{customer.notes || 'No notes available'}</p>
              )}
            </CardContent>
          </Card>
        </motion.div>
        </div>

        {/* Modify Service Dialog */}
        <Dialog open={showModifyDialog} onOpenChange={setShowModifyDialog}>
         <DialogContent className="max-w-md">
           <DialogHeader>
             <DialogTitle>Modify Service</DialogTitle>
           </DialogHeader>
           <div className="space-y-4">
             <p className="text-sm text-slate-600">
               Change service plan or configuration for {customer.full_name}.
             </p>
             <div className="space-y-3">
               <div>
                 <Label className="text-xs text-slate-500">Current Plan</Label>
                 <p className="text-slate-900 font-medium">{customer.plan_name || 'N/A'}</p>
               </div>
               <div>
                 <Label htmlFor="new-plan" className="text-sm">Select New Plan</Label>
                 <Select defaultValue="">
                   <SelectTrigger id="new-plan">
                     <SelectValue placeholder="Choose a plan..." />
                   </SelectTrigger>
                   <SelectContent>
                     <SelectItem value="basic">Basic Plan</SelectItem>
                     <SelectItem value="standard">Standard Plan</SelectItem>
                     <SelectItem value="premium">Premium Plan</SelectItem>
                   </SelectContent>
                 </Select>
               </div>
             </div>
             <div className="flex justify-end gap-3 pt-4">
               <Button variant="outline" onClick={() => setShowModifyDialog(false)}>
                 Cancel
               </Button>
               <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={() => {
                 toast.success('Service modification initiated');
                 setShowModifyDialog(false);
               }}>
                 Modify Service
               </Button>
             </div>
           </div>
         </DialogContent>
        </Dialog>

        {/* Provision Dialog */}
        <Dialog open={showProvisionDialog} onOpenChange={setShowProvisionDialog}>
         <DialogContent className="max-w-md">
           <DialogHeader>
             <DialogTitle>Provision Customer</DialogTitle>
           </DialogHeader>
           <div className="space-y-4">
             <p className="text-sm text-slate-600">
               Provision network access for {customer.full_name}.
             </p>
             <div className="space-y-3">
               <div>
                 <Label>Customer Name</Label>
                 <p className="text-slate-900 font-medium">{customer.full_name}</p>
               </div>
               <div>
                 <Label>IP Address</Label>
                 <p className="text-slate-900 font-mono text-sm">{customer.ip_address || 'Not assigned'}</p>
               </div>
               <div>
                 <Label>MAC Address</Label>
                 <p className="text-slate-900 font-mono text-sm">{customer.mac_address || 'Not assigned'}</p>
               </div>
             </div>
             <div className="flex justify-end gap-3 pt-4">
               <Button variant="outline" onClick={() => setShowProvisionDialog(false)}>
                 Cancel
               </Button>
               <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => {
                 toast.success('Provisioning initiated successfully');
                 setShowProvisionDialog(false);
               }}>
                 Start Provisioning
               </Button>
             </div>
           </div>
         </DialogContent>
        </Dialog>
        </div>
             );
             }