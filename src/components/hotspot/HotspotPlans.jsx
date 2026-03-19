import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Plus, Clock, Wifi, CreditCard, MoreVertical } from 'lucide-react';
import { motion } from 'framer-motion';

const plans = [
  {
    id: '1',
    name: 'Standard Hourly',
    price: '$1.00',
    duration: '1 Hour',
    bandwidth: '5Mbps / 2Mbps',
    status: 'active'
  },
  {
    id: '2',
    name: 'Daily Unlimited',
    price: '$5.00',
    duration: '24 Hours',
    bandwidth: '10Mbps / 5Mbps',
    status: 'active'
  },
  {
    id: '3',
    name: 'Weekly Premium',
    price: '$25.00',
    duration: '7 Days',
    bandwidth: '50Mbps / 20Mbps',
    status: 'active'
  },
  {
    id: '4',
    name: 'Trial Pack',
    price: 'Free',
    duration: '30 Minutes',
    bandwidth: '1Mbps / 1Mbps',
    status: 'inactive'
  }
];

export default function HotspotPlans() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Hotspot Plans</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Create and manage your hotspot service plans</p>
        </div>
        <Button className="bg-indigo-600 hover:bg-indigo-700 h-10 px-4">
          <Plus className="w-4 h-4 mr-2" />
          Create New Plan
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {plans.map((plan, index) => (
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card className="hover:shadow-lg transition-all duration-300 border-none shadow-md overflow-hidden group dark:bg-slate-900">
              <CardContent className="p-0">
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 transition-colors group-hover:bg-indigo-600 dark:group-hover:bg-indigo-500 group-hover:text-white`}>
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 dark:text-white">{plan.name}</h4>
                        <span className={`text-[10px] uppercase tracking-wider font-bold ${plan.status === 'active' ? 'text-emerald-500' : 'text-slate-400'}`}>
                          {plan.status}
                        </span>
                      </div>
                    </div>
                    <button className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-400 border border-transparent hover:border-slate-200 dark:hover:border-slate-700">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-6">
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center group-hover:bg-white dark:group-hover:bg-slate-800 border border-transparent group-hover:border-indigo-100 dark:group-hover:border-indigo-900/40 transition-all">
                      <CreditCard className="w-4 h-4 mx-auto mb-1.5 text-slate-400 dark:text-slate-500" />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 leading-none">Price</p>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{plan.price}</p>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center group-hover:bg-white dark:group-hover:bg-slate-800 border border-transparent group-hover:border-indigo-100 dark:group-hover:border-indigo-900/40 transition-all">
                      <Clock className="w-4 h-4 mx-auto mb-1.5 text-slate-400 dark:text-slate-500" />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 leading-none">Duration</p>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{plan.duration}</p>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center group-hover:bg-white dark:group-hover:bg-slate-800 border border-transparent group-hover:border-indigo-100 dark:group-hover:border-indigo-900/40 transition-all">
                      <Wifi className="w-4 h-4 mx-auto mb-1.5 text-slate-400 dark:text-slate-500" />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 leading-none">Speed</p>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{plan.bandwidth.split(' ')[0]}</p>
                    </div>
                  </div>
                </div>
                <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center group-hover:bg-indigo-50/50 dark:group-hover:bg-indigo-900/20 transition-colors">
                  <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {Math.floor(Math.random() * 50)} users subscribed
                  </span>
                  <button className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 uppercase tracking-wider">
                    Edit Details
                  </button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function Button({ children, className = '', ...props }) {
  return (
    <button className={`inline-flex items-center justify-center rounded-lg font-medium transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 text-white bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-200 dark:shadow-none ring-indigo-500 ${className}`} {...props}>
      {children}
    </button>
  );
}
