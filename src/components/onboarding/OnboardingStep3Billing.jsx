import React from 'react';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, DollarSign, AlertCircle } from 'lucide-react';

export default function OnboardingStep3Billing({ formData, setFormData }) {
  const handleBillingCycleChange = (day) => {
    setFormData({ ...formData, billing_cycle_day: day });
  };

  const daysOfMonth = Array.from({ length: 28 }, (_, i) => (i + 1).toString());

  const monthlyRate = parseFloat(formData.monthly_rate) || 0;
  const dailyRate = monthlyRate / 30;

  return (
    <div className="space-y-6">
      <Card className="bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 transition-colors">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-indigo-900 dark:text-indigo-200">
            <DollarSign className="w-5 h-5" />
            Billing Configuration
          </CardTitle>
          <CardDescription className="text-indigo-800 dark:text-indigo-300">
            Set up the customer's billing cycle and review charges
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="space-y-4">
        {/* Monthly Rate */}
        <Card className="bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 transition-colors">
          <CardContent className="pt-4">
            <div className="space-y-2">
              <Label className="dark:text-slate-300">Monthly Service Rate</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-600 dark:text-slate-400">KES</span>
                <input
                  type="number"
                  value={formData.monthly_rate}
                  readOnly
                  className="w-full pl-12 pr-4 py-2 border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold transition-colors"
                />
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Based on the selected service plan
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Billing Cycle Day */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2 dark:text-slate-300">
            <Calendar className="w-4 h-4" />
            Billing Cycle Day
          </Label>
          <Select
            value={formData.billing_cycle_day}
            onValueChange={handleBillingCycleChange}
          >
            <SelectTrigger className="dark:bg-slate-900 dark:border-slate-800 dark:text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="dark:bg-slate-900 dark:border-slate-800">
              {daysOfMonth.map(day => (
                <SelectItem key={day} value={day} className="dark:text-slate-200 dark:focus:bg-slate-800">
                  Day {day} of every month
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Invoice will be generated on the selected day each month
          </p>
        </div>
      </div>

      {/* Billing Summary */}
      <Card className="dark:bg-slate-900 dark:border-slate-800 transition-colors">
        <CardHeader>
          <CardTitle className="text-lg dark:text-white">Billing Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Monthly Charge</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">
                KES {monthlyRate.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Daily Rate</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">
                KES {dailyRate.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg col-span-2">
              <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">Billing Cycle</p>
              <p className="text-lg font-semibold text-blue-900 dark:text-blue-200">
                Day {formData.billing_cycle_day} of each month
              </p>
            </div>
          </div>

          {/* Notes */}
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-400 flex gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <strong>Payment Terms:</strong> Invoices will be issued monthly on the billing cycle day. Customers have 7 days to pay from invoice date.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}