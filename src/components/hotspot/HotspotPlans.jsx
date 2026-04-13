import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { Plus, Edit2, Trash2, Clock, Zap, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import EmptyState from '@/components/shared/EmptyState';

export default function HotspotPlans() {
  const [showForm, setShowForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const queryClient = useQueryClient();

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['hotspot-plans'],
    queryFn: () => vibelink.entities.HotspotPlan.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => vibelink.entities.HotspotPlan.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['hotspot-plans']);
      setShowForm(false);
      setEditingPlan(null);
      toast.success('Plan created successfully');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => vibelink.entities.HotspotPlan.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['hotspot-plans']);
      setShowForm(false);
      setEditingPlan(null);
      toast.success('Plan updated successfully');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => vibelink.entities.HotspotPlan.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['hotspot-plans']);
      toast.success('Plan deleted successfully');
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Hotspot Plans</h3>
          <p className="text-sm text-slate-500">{plans.length} plans available</p>
        </div>
        <Button onClick={() => { setEditingPlan(null); setShowForm(true); }} className="bg-indigo-600 hover:bg-indigo-700">
          <Plus className="w-4 h-4 mr-2" />
          Create Plan
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <div key={i} className="h-48 bg-white dark:bg-slate-900 rounded-2xl animate-pulse" />)}
        </div>
      ) : plans.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No plans created"
          description="Create your first hotspot plan"
          actionLabel="Create Plan"
          onAction={() => setShowForm(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {plans.map((plan, idx) => (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
            >
              <Card className="hover:shadow-lg transition-all">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                      {!plan.is_active && <Badge variant="outline" className="mt-2">Inactive</Badge>}
                    </div>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditingPlan(plan); setShowForm(true); }}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="text-rose-500" onClick={() => {
                        if (confirm('Delete this plan?')) deleteMutation.mutate(plan.id);
                      }}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                      <Clock className="w-4 h-4" />
                      {plan.duration_minutes} minutes
                    </div>
                    <div className="text-2xl font-bold text-indigo-600">
                      KES {plan.price}
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                      <Zap className="w-4 h-4" />
                      {plan.bandwidth_limit} Mbps
                    </div>
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                      <Database className="w-4 h-4" />
                      {plan.data_limit_mb > 0 ? `${plan.data_limit_mb} MB` : 'Unlimited'}
                    </div>
                  </div>
                  {plan.description && (
                    <p className="text-xs text-slate-500 border-t pt-3">{plan.description}</p>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <PlanFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        plan={editingPlan}
        onSubmit={(data) => {
          if (editingPlan) {
            updateMutation.mutate({ id: editingPlan.id, data });
          } else {
            createMutation.mutate(data);
          }
        }}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}

function PlanFormDialog({ open, onOpenChange, plan, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({
    name: '', duration_minutes: 60, data_limit_mb: 0, bandwidth_limit: 10, price: 50, description: '', is_active: true
  });

  React.useEffect(() => {
    if (plan) {
      setFormData({
        name: plan.name || '', duration_minutes: plan.duration_minutes || 60, data_limit_mb: plan.data_limit_mb || 0,
        bandwidth_limit: plan.bandwidth_limit || 10, price: plan.price || 50, description: plan.description || '',
        is_active: plan.is_active ?? true
      });
    } else {
      setFormData({
        name: '', duration_minutes: 60, data_limit_mb: 0, bandwidth_limit: 10, price: 50, description: '', is_active: true
      });
    }
  }, [plan, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{plan ? 'Edit Plan' : 'Create Plan'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(formData); }} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>Plan Name *</Label>
            <Input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} placeholder="e.g., 1 Hour Basic" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Duration (minutes) *</Label>
              <Input type="number" value={formData.duration_minutes} onChange={(e) => setFormData({...formData, duration_minutes: Number(e.target.value)})} required />
            </div>
            <div className="space-y-2">
              <Label>Price (KES) *</Label>
              <Input type="number" step="0.01" value={formData.price} onChange={(e) => setFormData({...formData, price: Number(e.target.value)})} required />
            </div>
            <div className="space-y-2">
              <Label>Speed Limit (Mbps) *</Label>
              <Input type="number" value={formData.bandwidth_limit} onChange={(e) => setFormData({...formData, bandwidth_limit: Number(e.target.value)})} required />
            </div>
            <div className="space-y-2">
              <Label>Data Limit (MB)</Label>
              <Input type="number" value={formData.data_limit_mb} onChange={(e) => setFormData({...formData, data_limit_mb: Number(e.target.value)})} placeholder="0 = unlimited" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={2} />
          </div>
          <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
            <Label>Active</Label>
            <Switch checked={formData.is_active} onCheckedChange={(v) => setFormData({...formData, is_active: v})} />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700">
              {isLoading ? 'Saving...' : plan ? 'Update Plan' : 'Create Plan'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}