import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { format } from 'date-fns';

export default function InvoicePreview({ invoice, open, onOpenChange }) {
  const [isDownloading, setIsDownloading] = useState(false);

  if (!invoice) return null;

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const { html2pdf } = await import('html2pdf.js');
      const element = document.getElementById('invoice-preview');
      
      const opt = {
        margin: 10,
        filename: `${invoice.invoice_number}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
      };

      html2pdf().set(opt).from(element).save();
    } catch (error) {
      console.error('PDF download failed:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invoice {invoice.invoice_number}</DialogTitle>
        </DialogHeader>

        {/* Invoice Preview */}
        <div id="invoice-preview" className="bg-white p-8 space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start border-b pb-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">INVOICE</h1>
              <p className="text-slate-600 mt-1">{invoice.invoice_number}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-600">
                <span className="font-semibold">Issued:</span> {format(new Date(invoice.created_date), 'MMM d, yyyy')}
              </p>
              <p className="text-sm text-slate-600">
                <span className="font-semibold">Due:</span> {format(new Date(invoice.due_date), 'MMM d, yyyy')}
              </p>
            </div>
          </div>

          {/* Bill To */}
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-sm font-semibold text-slate-900 mb-2">BILL TO:</p>
              <p className="font-semibold text-slate-900">{invoice.customer_name}</p>
              <p className="text-sm text-slate-600">{invoice.customer_email}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 mb-2">FROM:</p>
              <p className="font-semibold text-slate-900">VIBELINK</p>
              <p className="text-sm text-slate-600">ISP Management Platform</p>
            </div>
          </div>

          {/* Line Items */}
          <div className="space-y-4">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-slate-300">
                  <th className="text-left text-sm font-semibold text-slate-900 py-3">Description</th>
                  <th className="text-right text-sm font-semibold text-slate-900 py-3">Qty</th>
                  <th className="text-right text-sm font-semibold text-slate-900 py-3">Unit Price</th>
                  <th className="text-right text-sm font-semibold text-slate-900 py-3">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items?.map((item, idx) => (
                  <tr key={idx} className="border-b border-slate-200">
                    <td className="text-sm text-slate-700 py-3">{item.description}</td>
                    <td className="text-right text-sm text-slate-700 py-3">{item.quantity}</td>
                    <td className="text-right text-sm text-slate-700 py-3">
                      KES {item.unit_price.toLocaleString('en-KE')}
                    </td>
                    <td className="text-right text-sm text-slate-700 py-3">
                      KES {item.total.toLocaleString('en-KE')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-80 space-y-2">
              <div className="flex justify-between py-2 border-b border-slate-200">
                <span className="text-slate-700">Subtotal:</span>
                <span className="text-slate-900 font-semibold">
                  KES {invoice.subtotal.toLocaleString('en-KE')}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-200">
                <span className="text-slate-700">Tax ({invoice.tax_rate}%):</span>
                <span className="text-slate-900 font-semibold">
                  KES {invoice.tax_amount.toLocaleString('en-KE')}
                </span>
              </div>
              <div className="flex justify-between py-3 bg-indigo-50 px-3 rounded-lg">
                <span className="text-slate-900 font-bold">Total:</span>
                <span className="text-indigo-600 font-bold text-lg">
                  KES {invoice.total_amount.toLocaleString('en-KE')}
                </span>
              </div>
            </div>
          </div>

          {/* Payment Status */}
          {invoice.status === 'paid' && invoice.payment_date && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-700">
                <span className="font-semibold">Paid:</span> {format(new Date(invoice.payment_date), 'MMM d, yyyy')}
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 border-t pt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={handleDownload}
            disabled={isDownloading}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            <Download className="w-4 h-4 mr-2" />
            {isDownloading ? 'Downloading...' : 'Download PDF'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}