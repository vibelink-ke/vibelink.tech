import { Button } from '@/components/ui/button';
import { Download, FileText } from 'lucide-react';
import { motion } from 'framer-motion';

export const exportToCSV = (data, columns, filename = 'report.csv') => {
  const csv = [
    columns.map(col => `"${col}"`).join(','),
    ...data.map(row => 
      columns.map(col => {
        const value = row[col];
        return `"${value !== null && value !== undefined ? String(value).replace(/"/g, '""') : ''}"`;
      }).join(',')
    )
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportToPDF = async (data, columns, title, filename = 'report.pdf') => {
  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF();
  
  doc.setFontSize(16);
  doc.text(title, 14, 15);
  
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 25);
  
  doc.setTextColor(0);
  doc.setFontSize(9);

  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const lineHeight = 6;
  let yPosition = 35;

  // Table headers
  const columnWidths = columns.map(col => (pageWidth - 2 * margin) / columns.length);
  
  // Draw headers
  doc.setFillColor(99, 102, 241);
  doc.setTextColor(255, 255, 255);
  doc.setFont(undefined, 'bold');
  
  let xPos = margin;
  columns.forEach((col, i) => {
    doc.text(col, xPos + 2, yPosition);
    xPos += columnWidths[i];
  });

  yPosition += lineHeight + 2;

  // Draw rows
  doc.setTextColor(0);
  doc.setFont(undefined, 'normal');
  let rowCount = 0;

  data.forEach(row => {
    if (yPosition > pageHeight - 20) {
      doc.addPage();
      yPosition = 20;
    }

    if (rowCount % 2 === 0) {
      doc.setFillColor(245, 245, 250);
      xPos = margin;
      columns.forEach((col, i) => {
        doc.rect(xPos, yPosition - 4, columnWidths[i], lineHeight);
        xPos += columnWidths[i];
      });
    }

    xPos = margin;
    columns.forEach((col, i) => {
      const value = row[col] !== null && row[col] !== undefined ? String(row[col]) : '';
      doc.text(value.substring(0, 20), xPos + 2, yPosition);
      xPos += columnWidths[i];
    });

    yPosition += lineHeight;
    rowCount++;
  });

  doc.save(filename);
};

export default function ExportButtons({ data, columns, title, filename = 'report' }) {
  return (
    <motion.div 
      className="flex gap-2"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2 }}
    >
      <Button 
        variant="outline" 
        size="sm"
        onClick={() => exportToCSV(data, columns, `${filename}.csv`)}
        className="gap-2"
      >
        <Download className="w-4 h-4" />
        Export CSV
      </Button>
      <Button 
        variant="outline" 
        size="sm"
        onClick={() => exportToPDF(data, columns, title, `${filename}.pdf`)}
        className="gap-2"
      >
        <FileText className="w-4 h-4" />
        Export PDF
      </Button>
    </motion.div>
  );
}