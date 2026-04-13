import React, { useState } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowRight, Calendar, DollarSign, AlertTriangle } from 'lucide-react';

export default function PlanChangeDialog({ 
  open, 
  onOpenChange, 
  customer, 
  newPlan, 
  oldPlan 
}) {
  const [effectiveDate, setEffectiveDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const queryClient = useQueryClient();

  const changePlanMutation = useMutation({
    mutationFn: async () => {
      const response = await vibelink.functions.invoke('applyPlanChange', {
        customer_id: customer.id,
        new_plan_id: newPlan.id,
        effective_date: effectiveDate
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['customers']);
      queryClient.invalidateQueries(['invoices']);
      onOpenChange(false);
    }
  });

  const calculateProRata = () => {
    if (!oldPlan || !newPlan) return { credit: 0, charge: 0, net: 0 };

    const now = new Date(effectiveDate);
    const billingDay = customer.billing_cycle_day || 1;
    
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const cycleStart = new Date(currentYear, currentMonth, billingDay);
    const cycleEnd = new Date(currentYear, currentMonth + 1, billingDay);
    
    const daysUsed = Math.floor((now - cycleStart) / (1000 * 60 * 60 * 24));
    const daysInCycle = Math.floor((cycleEnd - cycleStart) / (1000 * 60 * 60 * 24));
    const daysRemaining = daysInCycle - daysUsed;
    
    const dailyOldRate = oldPlan.monthly_price / daysInCycle;
    const dailyNewRate = newPlan.monthly_price / daysInCycle;
    
    const credit = dailyOldRate * daysRemaining;
    const charge = dailyNewRate * daysRemaining;
    const net = charge - credit;
    
    return { credit, charge, net, daysRemaining };
  };

  const proRata = calculateProRata();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Change Service Plan</DialogTitle>
          <DialogDescription>
            Review the plan change details and pro-rata billing adjustment
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Plan Change Summary */}
          <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
            <div className="flex-1">
              <p className="text-sm text-slate-500 mb-1">Current Plan</p>
              <p className="font-semibold text-slate-900 dark:text-slate-50">{oldPlan?.name || 'None'}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">KES {oldPlan?.monthly_price || 0}/month</p>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-400" />
            <div className="flex-1">
              <p className="text-sm text-slate-500 mb-1">New Plan</p>
              <p className="font-semibold text-slate-900 dark:text-slate-50">{newPlan.name}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">KES {newPlan.monthly_price}/month</p>
            </div>
          </div>

          {/* Effective Date */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Effective Date
            </Label>
            <Input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
            />
          </div>

          {/* Pro-Rata Calculation */}
          {oldPlan && proRata.daysRemaining > 0 && (
            <div className="space-y-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
              <div className="flex items-start gap-2">
                <DollarSign className="w-5 h-5 text-blue-600 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <p className="font-semibold text-blue-900">Pro-Rata Billing Adjustment</p>
                  <p className="text-sm text-blue-700">
                    Based on {proRata.daysRemaining} days remaining in billing cycle
                  </p>
                  
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-blue-700">Credit (unused {oldPlan.name}):</span>
                      <span className="font-semibold text-blue-900">
                        -KES {proRata.credit.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-blue-700">Charge ({newPlan.name}):</span>
                      <span className="font-semibold text-blue-900">
                        +KES {proRata.charge.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-blue-200">
                      <span className="font-semibold text-blue-900">Net Amount:</span>
                      <span className={`font-bold ${
                        proRata.net > 0 ? 'text-red-600' : 'text-emerald-600'
                      }`}>
                        {proRata.net > 0 ? '+' : ''}KES {proRata.net.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Upgrade/Downgrade Notice */}
          {oldPlan && (
            <Alert>
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription className="text-sm">
                {newPlan.monthly_price > oldPlan.monthly_price ? (
                  <>
                    <strong>Upgrade Notice:</strong> You will be charged the pro-rata amount immediately.
                    The full monthly rate starts next billing cycle.
                  </>
                ) : (
                  <>
                    <strong>Downgrade Notice:</strong> Unused credit will be applied to your account.
                    The new rate takes effect immediately.
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              disabled={changePlanMutation.isPending}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => changePlanMutation.mutate()}
              disabled={changePlanMutation.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {changePlanMutation.isPending ? 'Processing...' : 'Confirm Change'}
            </Button>
          </div>

          {changePlanMutation.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {changePlanMutation.error?.message || 'Failed to change plan'}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}