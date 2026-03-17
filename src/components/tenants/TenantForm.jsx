import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

const plans = [
  { value: 'starter', label: 'Starter - KES 5,000/month' },
  { value: 'professional', label: 'Professional - KES 15,000/month' },
  { value: 'enterprise', label: 'Enterprise - Custom pricing' },
];

const statuses = [
  { value: 'trial', label: 'Trial' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function TenantForm({ tenant, onSubmit, isLoading }) {
  const [formData, setFormData] = useState(
    tenant || {
      company_name: '',
      subdomain: '',
      admin_name: '',
      admin_email: '',
      phone: '',
      address: '',
      city: '',
      country: '',
      status: 'trial',
      subscription_plan: 'starter',
      monthly_price: 5000,
      max_customers: 100,
      max_staff: 5,
      onboarded: false,
      safaricom_paybill: {
        enabled: false,
        paybill_number: '',
        paybill_name: '',
        account_number: '',
        api_key: '',
      },
      kopo_kopo: {
        enabled: false,
        merchant_id: '',
        api_key: '',
        api_secret: '',
        short_code: '',
      },
    }
  );

  const handleChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handlePaymentFieldChange = (provider, field, value) => {
    setFormData((prev) => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        [field]: value,
      },
    }));
  };

  const handlePlanChange = (plan) => {
    const prices = { starter: 5000, professional: 15000, enterprise: 0 };
    setFormData((prev) => ({
      ...prev,
      subscription_plan: plan,
      monthly_price: prices[plan],
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleCreateAndOnboard = async (e) => {
    e.preventDefault();
    // First create the tenant
    const result = await onSubmit(formData);
    // The parent component will handle onboarding redirect
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Company Information */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <h3 className="font-semibold text-slate-900">Company Information</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="company_name">Company Name *</Label>
              <Input
                id="company_name"
                value={formData.company_name}
                onChange={(e) => handleChange('company_name', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subdomain">Subdomain *</Label>
              <div className="flex">
                <Input
                  id="subdomain"
                  value={formData.subdomain}
                  onChange={(e) => {
                    const value = e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]/g, '');
                    handleChange('subdomain', value);
                  }}
                  placeholder="company-name"
                  required
                  className="rounded-r-none"
                />
                <div className="flex items-center px-3 bg-slate-100 border border-l-0 border-input rounded-r-md text-slate-600 text-sm font-mono">
                  .vibelink.tech
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => handleChange('city', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                value={formData.country}
                onChange={(e) => handleChange('country', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => handleChange('address', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Admin Information */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <h3 className="font-semibold text-slate-900">Admin Information</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="admin_name">Admin Name *</Label>
              <Input
                id="admin_name"
                value={formData.admin_name}
                onChange={(e) => handleChange('admin_name', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin_email">Admin Email *</Label>
              <Input
                id="admin_email"
                type="email"
                value={formData.admin_email}
                onChange={(e) => handleChange('admin_email', e.target.value)}
                required
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Subscription */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <h3 className="font-semibold text-slate-900">Subscription</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="plan">Plan *</Label>
              <Select value={formData.subscription_plan} onValueChange={handlePlanChange}>
                <SelectTrigger id="plan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.value} value={plan.value}>
                      {plan.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status *</Label>
              <Select value={formData.status} onValueChange={(v) => handleChange('status', v)}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="max_customers">Max Customers</Label>
              <Input
                id="max_customers"
                type="number"
                value={formData.max_customers}
                onChange={(e) => handleChange('max_customers', parseInt(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max_staff">Max Staff</Label>
              <Input
                id="max_staff"
                type="number"
                value={formData.max_staff}
                onChange={(e) => handleChange('max_staff', parseInt(e.target.value))}
              />
            </div>
          </div>

          {formData.subscription_plan === 'trial' && (
            <div className="space-y-2">
              <Label htmlFor="trial_ends_at">Trial Ends</Label>
              <Input
                id="trial_ends_at"
                type="datetime-local"
                value={formData.trial_ends_at || ''}
                onChange={(e) => handleChange('trial_ends_at', e.target.value)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Options */}
      <Card>
        <CardContent className="pt-6 space-y-6">
          <h3 className="font-semibold text-slate-900">Payment Options</h3>

          {/* Safaricom Paybill */}
          <div className="space-y-4 pb-4 border-b">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-slate-900">Safaricom Paybill</h4>
                <p className="text-xs text-slate-500 mt-1">Accept customer payments via Safaricom Paybill</p>
              </div>
              <Switch
                checked={formData.safaricom_paybill.enabled}
                onCheckedChange={(checked) =>
                  handlePaymentFieldChange('safaricom_paybill', 'enabled', checked)
                }
              />
            </div>

            {formData.safaricom_paybill.enabled && (
              <div className="grid grid-cols-2 gap-4 ml-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="paybill_number">Paybill Number</Label>
                  <Input
                    id="paybill_number"
                    placeholder="e.g., 522522"
                    value={formData.safaricom_paybill.paybill_number}
                    onChange={(e) =>
                      handlePaymentFieldChange('safaricom_paybill', 'paybill_number', e.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paybill_name">Business Name</Label>
                  <Input
                    id="paybill_name"
                    placeholder="Business name on Paybill"
                    value={formData.safaricom_paybill.paybill_name}
                    onChange={(e) =>
                      handlePaymentFieldChange('safaricom_paybill', 'paybill_name', e.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="account_number">Account Number</Label>
                  <Input
                    id="account_number"
                    placeholder="For transaction routing"
                    value={formData.safaricom_paybill.account_number}
                    onChange={(e) =>
                      handlePaymentFieldChange('safaricom_paybill', 'account_number', e.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paybill_api_key">API Key</Label>
                  <Input
                    id="paybill_api_key"
                    type="password"
                    placeholder="Safaricom API key"
                    value={formData.safaricom_paybill.api_key}
                    onChange={(e) =>
                      handlePaymentFieldChange('safaricom_paybill', 'api_key', e.target.value)
                    }
                  />
                </div>
              </div>
            )}
          </div>

          {/* Kopo Kopo STK */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-slate-900">Kopo Kopo STK</h4>
                <p className="text-xs text-slate-500 mt-1">STK push payments for customer convenience</p>
              </div>
              <Switch
                checked={formData.kopo_kopo.enabled}
                onCheckedChange={(checked) =>
                  handlePaymentFieldChange('kopo_kopo', 'enabled', checked)
                }
              />
            </div>

            {formData.kopo_kopo.enabled && (
              <div className="grid grid-cols-2 gap-4 ml-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="merchant_id">Merchant ID</Label>
                  <Input
                    id="merchant_id"
                    placeholder="Kopo Kopo merchant ID"
                    value={formData.kopo_kopo.merchant_id}
                    onChange={(e) =>
                      handlePaymentFieldChange('kopo_kopo', 'merchant_id', e.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="short_code">Short Code</Label>
                  <Input
                    id="short_code"
                    placeholder="STK push short code"
                    value={formData.kopo_kopo.short_code}
                    onChange={(e) =>
                      handlePaymentFieldChange('kopo_kopo', 'short_code', e.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="kopo_api_key">API Key</Label>
                  <Input
                    id="kopo_api_key"
                    type="password"
                    placeholder="Kopo Kopo API key"
                    value={formData.kopo_kopo.api_key}
                    onChange={(e) =>
                      handlePaymentFieldChange('kopo_kopo', 'api_key', e.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="api_secret">API Secret</Label>
                  <Input
                    id="api_secret"
                    type="password"
                    placeholder="Kopo Kopo API secret"
                    value={formData.kopo_kopo.api_secret}
                    onChange={(e) =>
                      handlePaymentFieldChange('kopo_kopo', 'api_secret', e.target.value)
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        {!tenant && (
          <Button 
            type="button"
            variant="outline"
            onClick={(e) => {
              e.preventDefault();
              onSubmit(formData, 'create_and_onboard');
            }}
            disabled={isLoading}
          >
            {isLoading ? 'Creating...' : 'Create & Onboard'}
          </Button>
        )}
        <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700" disabled={isLoading}>
          {isLoading ? 'Saving...' : tenant ? 'Update Tenant' : 'Create Tenant'}
        </Button>
      </div>
    </form>
  );
}