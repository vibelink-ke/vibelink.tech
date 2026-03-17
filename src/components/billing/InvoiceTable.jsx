import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Download, Eye, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

const statusColors = {
  draft: 'bg-slate-100 text-slate-800',
  sent: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  cancelled: 'bg-slate-100 text-slate-600'
};

export default function InvoiceTable({ invoices, isLoading, onViewInvoice, onDownloadInvoice }) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 flex justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-600" />
        </CardContent>
      </Card>
    );
  }

  if (!invoices || invoices.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600">No invoices yet. They will appear here once generated.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Invoice</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Period</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Amount</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Due Date</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Status</th>
                <th className="text-right py-3 px-4 font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              <AnimatePresence>
                {invoices.map((invoice, idx) => {
                  const isOverdue = 
                    invoice.status === 'sent' && 
                    new Date(invoice.due_date) < new Date();

                  return (
                    <motion.tr
                      key={invoice.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ delay: idx * 0.05 }}
                      className="hover:bg-slate-50"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-slate-400" />
                          <span className="font-medium text-slate-900">
                            {invoice.invoice_number}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-600">
                        {format(new Date(invoice.billing_period_start), 'MMM d, yyyy')} - {' '}
                        {format(new Date(invoice.billing_period_end), 'MMM d, yyyy')}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        KES {invoice.total_amount.toLocaleString('en-KE')}
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-600">
                        <div className="flex items-center gap-2">
                          {isOverdue && <AlertCircle className="w-4 h-4 text-red-500" />}
                          {format(new Date(invoice.due_date), 'MMM d, yyyy')}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge className={statusColors[invoice.status] || statusColors.draft}>
                          {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                          {isOverdue && ' - Overdue'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                       <div className="flex justify-end gap-2">
                         <Button
                           size="sm"
                           variant="ghost"
                           onClick={() => onViewInvoice(invoice)}
                           title="View invoice"
                         >
                           <Eye className="w-4 h-4" />
                         </Button>
                         <Button
                           size="sm"
                           variant="ghost"
                           onClick={() => onDownloadInvoice(invoice)}
                           title="Download PDF"
                         >
                           <Download className="w-4 h-4" />
                         </Button>
                         {invoice.status !== 'paid' && (
                           <Button
                             size="sm"
                             variant="outline"
                             className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                             onClick={() => onViewInvoice(invoice)}
                           >
                             Pay
                           </Button>
                         )}
                       </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}