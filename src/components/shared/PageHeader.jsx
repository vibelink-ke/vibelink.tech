import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

function PageHeader({ title, subtitle, actionLabel = null, onAction = () => {}, actionIcon: ActionIcon = Plus, children = null }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8"
    >
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{title}</h1>
        {subtitle && (
          <p className="text-slate-500 dark:text-slate-400 mt-1">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {children}
        {actionLabel && (
          <Button onClick={onAction} className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200">
            <ActionIcon className="w-4 h-4 mr-2" />
            <span>{actionLabel}</span>
          </Button>
        )}
      </div>
    </motion.div>
  );
}

export default PageHeader;
export { PageHeader };