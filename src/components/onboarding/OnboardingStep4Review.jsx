import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export default function OnboardingStep4Review({
  formData,
  servicePlans = [],
  mikrotiks = [],
}) {
  const selectedPlan = servicePlans.find(p => p.id === formData.plan_id);
  const selectedMikrotik = mikrotiks.find(m => m.id === formData.mikrotik_id);

  const validateIPAddress = (ip) => {
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    return ipRegex.test(ip);
  };

  const validateMAC = (mac) => {
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    return mac === '' || macRegex.test(mac);
  };

  const isValid = {
    plan: !!formData.plan_id,
    router: !!formData.mikrotik_id,
    ip: validateIPAddress(formData.ip_address),
    mac: validateMAC(formData.mac_address),
    billing: !!formData.billing_cycle_day,
  };

  const allValid = Object.values(isValid).every(v => v);

  return (
    <div className="space-y-6">
      {/* Overall Status */}
      {allValid ? (
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-emerald-900">All Required Information Complete</p>
                <p className="text-sm text-emerald-800 mt-1">
                  Customer setup is ready to be finalized. Click "Complete Setup" to activate the account.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-900">Incomplete Information</p>
                <p className="text-sm text-amber-800 mt-1">
                  Please go back and complete all required fields before finalizing setup.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Service Plan Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            {isValid.plan ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-600" />
            )}
            Service Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {selectedPlan ? (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-900">{selectedPlan.name}</p>
                  <p className="text-sm text-slate-600">{selectedPlan.description}</p>
                </div>
                <Badge>{selectedPlan.tier}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-3 pt-3 border-t">
                <div>
                  <p className="text-xs text-slate-600">Download</p>
                  <p className="text-lg font-semibold text-slate-900">{selectedPlan.download_speed} Mbps</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Upload</p>
                  <p className="text-lg font-semibold text-slate-900">{selectedPlan.upload_speed} Mbps</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Price</p>
                  <p className="text-lg font-semibold text-indigo-600">
                    KES {selectedPlan.monthly_price.toLocaleString()}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-slate-600">No service plan selected</p>
          )}
        </CardContent>
      </Card>

      {/* Network Configuration Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            {isValid.router && isValid.ip ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-600" />
            )}
            Network Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3">
            <div className="p-3 bg-slate-50 rounded-lg">
              <p className="text-xs text-slate-600 mb-1">Router / MikroTik</p>
              <p className="font-semibold text-slate-900">
                {selectedMikrotik
                  ? `${selectedMikrotik.router_name || selectedMikrotik.name}`
                  : 'Not assigned'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-600 mb-1">IP Address</p>
                <p className="font-semibold text-slate-900 font-mono">{formData.ip_address}</p>
                {formData.ip_address && !isValid.ip && (
                  <p className="text-xs text-rose-600 mt-1">Invalid format</p>
                )}
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-600 mb-1">MAC Address</p>
                <p className="font-semibold text-slate-900 font-mono text-sm">
                  {formData.mac_address || 'Auto-detect'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Billing Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            {isValid.billing ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-600" />
            )}
            Billing Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-slate-50 rounded-lg">
              <p className="text-xs text-slate-600 mb-1">Monthly Charge</p>
              <p className="text-xl font-semibold text-slate-900">
                KES {parseFloat(formData.monthly_rate).toLocaleString('en-US', {
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg">
              <p className="text-xs text-slate-600 mb-1">Billing Date</p>
              <p className="text-xl font-semibold text-slate-900">
                Day {formData.billing_cycle_day}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Final Confirmation */}
      <Card className="bg-indigo-50 border-indigo-200">
        <CardContent className="pt-6">
          <p className="text-sm text-indigo-900 mb-3">
            <strong>Summary:</strong> Click "Complete Setup" to finalize the customer onboarding and activate their service. The customer will be notified of their new connection details.
          </p>
          <ul className="text-xs text-indigo-800 space-y-1 ml-4">
            <li>✓ Service plan will be activated immediately</li>
            <li>✓ Network routing will be configured on the assigned router</li>
            <li>✓ First monthly invoice will be generated</li>
            <li>✓ Customer status will change to "active"</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}