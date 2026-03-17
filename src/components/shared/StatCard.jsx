import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export default function StatCard({ title, value, subtitle, icon: Icon, trend, trendUp, className }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      className={cn(
        "bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-100 dark:border-slate-700",
        "shadow-sm hover:shadow-xl hover:shadow-indigo-100/50 dark:hover:shadow-indigo-900/30",
        "transition-all duration-300 group relative overflow-hidden",
        className
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 to-purple-50/50 dark:from-indigo-900/10 dark:to-purple-900/10 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative flex items-start justify-between">
        <div className="space-y-1 flex-1">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-300">{title}</p>
          <motion.p 
            className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            {value}
          </motion.p>
          {subtitle && (
            <p className="text-sm text-slate-400 dark:text-slate-400">{subtitle}</p>
          )}
          {trend && (
            <motion.div 
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className={cn(
                "inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full mt-2",
                trendUp 
                  ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" 
                  : "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400"
              )}
            >
              <motion.span
                animate={{ y: trendUp ? [-1, 0] : [1, 0] }}
                transition={{ repeat: Infinity, duration: 1, repeatType: "reverse" }}
              >
                {trendUp ? '↑' : '↓'}
              </motion.span>
              <span>{trend}</span>
            </motion.div>
          )}
        </div>
        {Icon && (
          <motion.div 
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.1, type: "spring" }}
            className="p-3 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 rounded-xl group-hover:scale-110 transition-transform"
          >
            <Icon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}