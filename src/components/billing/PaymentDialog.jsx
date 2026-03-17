import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { vibelink } from '@/api/vibelinkClient';
import { Loader } from 'lucide-react';

export default function PaymentDialog({ invoice, tenant, open, onOpenChange, onPaymentSuccess }) {
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!invoice || !tenant) return null;

  const paymentMethods = [];

  if (tenant.safaricom_paybill?.enabled) {
    paymentMethods.push({
      id: 'safaricom_paybill',
      name: 'Safaricom M-Pesa',
      description: 'Pay via Paybill',
      icon: '📱'
    });
  }

  if (tenant.kopo_kopo?.enabled) {
    paymentMethods.push({
      id: 'kopo_kopo_stk',
      name: 'Kopo Kopo STK',
      description: 'USSD payment',
      icon: '📞'
    });
  }

  const handleInitiatePayment = async () => {
    if (!selectedMethod) return;

    setIsLoading(true);
    try {
      const response = await vibelink.functions.invoke('initiateMobileMoneyPayment', {
        tenant_id: tenant.id,
        amount: invoice.total_amount,
        payment_method: selectedMethod
      });

      if (response.data.success) {
        onPaymentSuccess?.();
        onOpenChange(false);
      }
    } catch (error) {
      console.error('Payment initiation failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pay Invoice</DialogTitle>
          <DialogDescription>
            Select a payment method to pay {invoice.invoice_number}
          </DialogDescription>
        </DialogHeader>

        {/* Invoice Summary */}
        <Card className="bg-slate-50">
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Invoice:</span>
                <span className="font-semibold">{invoice.invoice_number}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Amount:</span>
                <span className="font-semibold text-lg">
                  KES {invoice.total_amount.toLocaleString('en-KE')}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Payment Methods */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-900">Select Payment Method:</p>
          
          {paymentMethods.length > 0 ? (
            <div className="space-y-2">
              {paymentMethods.map((method) => (
                <button
                  key={method.id}
                  onClick={() => setSelectedMethod(method.id)}
                  className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                    selectedMethod === method.id
                      ? 'border-indigo-600 bg-indigo-50'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{method.icon}</span>
                    <div className="flex-1">
                      <p className="font-semibold text-slate-900">{method.name}</p>
                      <p className="text-sm text-slate-600">{method.description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800">
                No payment methods configured. Please contact support.
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={handleInitiatePayment}
            disabled={!selectedMethod || isLoading}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700"
          >
            {isLoading ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              'Proceed to Payment'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}