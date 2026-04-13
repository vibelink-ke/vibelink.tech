import React from 'react';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

export default function SearchInput({ value, onChange, placeholder = "Search..." }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-10 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-50 dark:text-white placeholder:text-slate-400 focus:ring-indigo-500 focus:border-indigo-500"
      />
    </div>
  );
}