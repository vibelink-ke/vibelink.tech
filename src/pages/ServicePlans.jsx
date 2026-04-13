import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { 
  Wifi, 
  Plus, 
  Edit2, 
  Trash2, 
  Check,
  Zap,
  ArrowUp,
  ArrowDown,
  LayoutGrid,
  List,
  X
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import EmptyState from '@/components/shared/EmptyState';
import PlanComparison from '@/components/plans/PlanComparison';
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
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

export default function ServicePlans() {
  const [showForm, setShowForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'comparison'
  const queryClient = useQueryClient();

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: () => vibelink.entities.ServicePlan.list('priority'),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => vibelink.entities.Customer.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => vibelink.entities.ServicePlan.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['plans']);
      setShowForm(false);
      setEditingPlan(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => vibelink.entities.ServicePlan.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['plans']);
      setShowForm(false);
      setEditingPlan(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => vibelink.entities.ServicePlan.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['plans']),
  });

  const getSubscriberCount = (planId) => {
    return customers.filter(c => c.plan_id === planId).length;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <PageHeader
            title="Service Plans"
            subtitle="Manage your internet service packages and tiers"
          />
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('grid')}
            >
              <LayoutGrid className="w-4 h-4 mr-2" />
              Grid
            </Button>
            <Button
              variant={viewMode === 'comparison' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('comparison')}
            >
              <List className="w-4 h-4 mr-2" />
              Compare
            </Button>
            <Button onClick={() => { setEditingPlan(null); setShowForm(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Add Plan
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-72 bg-white dark:bg-slate-800 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : plans.length === 0 ? (
          <EmptyState
            icon={Wifi}
            title="No service plans"
            description="Create your first service plan to start offering internet packages"
            actionLabel="Add Plan"
            onAction={() => setShowForm(true)}
          />
        ) : viewMode === 'comparison' ? (
          <PlanComparison plans={plans} onSelectPlan={(plan) => { setEditingPlan(plan); setShowForm(true); }} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.map((plan, index) => (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="relative overflow-hidden hover:shadow-lg transition-shadow group">
                  {index === 0 && (
                    <div className="absolute top-4 right-4 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                      Popular
                    </div>
                  )}
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-50">{plan.name}</h3>
                        <StatusBadge status={plan.status} className="mt-2" />
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <Button 
                          size="icon" 
                          variant="ghost"
                          onClick={() => { setEditingPlan(plan); setShowForm(true); }}
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost"
                          className="text-rose-500"
                          onClick={() => deleteMutation.mutate(plan.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Price */}
                    <div>
                      <span className="text-4xl font-bold text-slate-900 dark:text-slate-50">KES {plan.monthly_price}</span>
                      <span className="text-slate-500">/month</span>
                    </div>

                    {/* Speed */}
                    <div className="flex items-center gap-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                      <div className="flex items-center gap-2">
                        <ArrowDown className="w-4 h-4 text-emerald-500" />
                        <span className="font-semibold">{plan.download_speed} Mbps</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ArrowUp className="w-4 h-4 text-blue-500" />
                        <span className="font-semibold">{plan.upload_speed} Mbps</span>
                      </div>
                    </div>

                    {/* Data Cap */}
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                      <Zap className="w-4 h-4" />
                      <span>{plan.data_cap === 0 ? 'Unlimited Data' : `${plan.data_cap} GB/month`}</span>
                    </div>

                    {/* Features */}
                    {plan.features?.length > 0 && (
                      <div className="space-y-2">
                        {plan.features.slice(0, 3).map((feature, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                            <Check className="w-4 h-4 text-emerald-500" />
                            <span>{feature}</span>
                          </div>
                        ))}
                        {plan.features.length > 3 && (
                          <p className="text-sm text-slate-400">+{plan.features.length - 3} more features</p>
                        )}
                      </div>
                    )}

                    {/* Stats */}
                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">Subscribers</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-50">{getSubscriberCount(plan.id)}</span>
                      </div>
                      {plan.setup_fee > 0 && (
                        <div className="flex items-center justify-between text-sm mt-1">
                          <span className="text-slate-500">Setup Fee</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-50">KES {plan.setup_fee}</span>
                        </div>
                      )}
                    </div>
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
    </div>
  );
}

function PlanFormDialog({ open, onOpenChange, plan, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    tier: 'standard',
    download_speed: 100,
    upload_speed: 50,
    data_cap: 0,
    monthly_price: 29.99,
    setup_fee: 0,
    status: 'active',
    features: [],
    priority: 0,
    billing_features: {
      supports_prorata: true,
      trial_days: 0,
      contract_length_months: 0
    },
    limits: {
      max_devices: 5,
      support_level: 'basic'
    }
  });
  const [featureInput, setFeatureInput] = useState('');
  const [featureValue, setFeatureValue] = useState('');

  React.useEffect(() => {
    if (plan) {
      setFormData({
        name: plan.name || '',
        description: plan.description || '',
        tier: plan.tier || 'standard',
        download_speed: plan.download_speed || 100,
        upload_speed: plan.upload_speed || 50,
        data_cap: plan.data_cap || 0,
        monthly_price: plan.monthly_price || 29.99,
        setup_fee: plan.setup_fee || 0,
        status: plan.status || 'active',
        features: plan.features || [],
        priority: plan.priority || 0,
        billing_features: plan.billing_features || { supports_prorata: true, trial_days: 0, contract_length_months: 0 },
        limits: plan.limits || { max_devices: 5, support_level: 'basic' }
      });
    } else {
      setFormData({
        name: '',
        description: '',
        tier: 'standard',
        download_speed: 100,
        upload_speed: 50,
        data_cap: 0,
        monthly_price: 29.99,
        setup_fee: 0,
        status: 'active',
        features: [],
        priority: 0,
        billing_features: { supports_prorata: true, trial_days: 0, contract_length_months: 0 },
        limits: { max_devices: 5, support_level: 'basic' }
      });
    }
  }, [plan, open]);

  const addFeature = () => {
    if (featureInput.trim()) {
      const newFeature = {
        name: featureInput.trim(),
        included: true,
        value: featureValue.trim() || undefined
      };
      setFormData(prev => ({
        ...prev,
        features: [...prev.features, newFeature]
      }));
      setFeatureInput('');
      setFeatureValue('');
    }
  };

  const removeFeature = (index) => {
    setFormData(prev => ({
      ...prev,
      features: prev.features.filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan ? 'Edit Service Plan' : 'Create Service Plan'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="features">Features</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Plan Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g., Premium 500Mbps"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  placeholder="Plan description..."
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>Plan Tier *</Label>
                <Select 
                  value={formData.tier} 
                  onValueChange={(value) => setFormData({...formData, tier: value})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Basic</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="premium">Premium</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Download Speed (Mbps) *</Label>
                <Input
                  type="number"
                  value={formData.download_speed}
                  onChange={(e) => setFormData({...formData, download_speed: Number(e.target.value)})}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Upload Speed (Mbps) *</Label>
                <Input
                  type="number"
                  value={formData.upload_speed}
                  onChange={(e) => setFormData({...formData, upload_speed: Number(e.target.value)})}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Data Cap (GB, 0 for unlimited)</Label>
              <Input
                type="number"
                value={formData.data_cap}
                onChange={(e) => setFormData({...formData, data_cap: Number(e.target.value)})}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Monthly Price (KES) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.monthly_price}
                  onChange={(e) => setFormData({...formData, monthly_price: Number(e.target.value)})}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Setup Fee (KES)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.setup_fee}
                  onChange={(e) => setFormData({...formData, setup_fee: Number(e.target.value)})}
                />
              </div>
            </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                <Label className="cursor-pointer">Active Plan</Label>
                <Switch
                  checked={formData.status === 'active'}
                  onCheckedChange={(checked) => setFormData({...formData, status: checked ? 'active' : 'inactive'})}
                />
              </div>
            </TabsContent>

            <TabsContent value="features" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Plan Features</Label>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={featureInput}
                      onChange={(e) => setFeatureInput(e.target.value)}
                      placeholder="Feature name (e.g., '24/7 Support')"
                      className="flex-1"
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())}
                    />
                    <Input
                      value={featureValue}
                      onChange={(e) => setFeatureValue(e.target.value)}
                      placeholder="Value (optional)"
                      className="w-32"
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())}
                    />
                    <Button type="button" variant="outline" onClick={addFeature}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500">
                    Add features with optional values (e.g., "Tech Support" with value "24/7")
                  </p>
                </div>
                {formData.features.length > 0 && (
                  <div className="space-y-2 mt-3">
                    {formData.features.map((feature, i) => {
                      const name = typeof feature === 'string' ? feature : feature.name;
                      const value = typeof feature === 'object' ? feature.value : null;
                      return (
                        <div 
                          key={i}
                          className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg"
                        >
                          <div className="flex items-center gap-2">
                            <Check className="w-4 h-4 text-emerald-500" />
                            <span className="font-medium">{name}</span>
                            {value && (
                              <span className="text-sm text-slate-500">({value})</span>
                            )}
                          </div>
                          <button 
                            type="button" 
                            onClick={() => removeFeature(i)}
                            className="text-slate-400 hover:text-rose-600"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="advanced" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Max Devices</Label>
                  <Input
                    type="number"
                    value={formData.limits.max_devices}
                    onChange={(e) => setFormData({
                      ...formData, 
                      limits: {...formData.limits, max_devices: Number(e.target.value)}
                    })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Support Level</Label>
                  <Select 
                    value={formData.limits.support_level} 
                    onValueChange={(value) => setFormData({
                      ...formData,
                      limits: {...formData.limits, support_level: value}
                    })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">Basic (Email)</SelectItem>
                      <SelectItem value="priority">Priority (Phone + Email)</SelectItem>
                      <SelectItem value="dedicated">Dedicated Account Manager</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <div>
                    <Label className="cursor-pointer">Pro-Rata Billing</Label>
                    <p className="text-xs text-slate-500 mt-1">Enable for mid-cycle plan changes</p>
                  </div>
                  <Switch
                    checked={formData.billing_features.supports_prorata}
                    onCheckedChange={(checked) => setFormData({
                      ...formData,
                      billing_features: {...formData.billing_features, supports_prorata: checked}
                    })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Trial Days</Label>
                    <Input
                      type="number"
                      value={formData.billing_features.trial_days}
                      onChange={(e) => setFormData({
                        ...formData,
                        billing_features: {...formData.billing_features, trial_days: Number(e.target.value)}
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Contract Length (months)</Label>
                    <Input
                      type="number"
                      value={formData.billing_features.contract_length_months}
                      onChange={(e) => setFormData({
                        ...formData,
                        billing_features: {...formData.billing_features, contract_length_months: Number(e.target.value)}
                      })}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700">
              {isLoading ? 'Saving...' : plan ? 'Update Plan' : 'Create Plan'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}