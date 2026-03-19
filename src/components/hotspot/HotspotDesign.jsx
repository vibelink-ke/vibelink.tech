import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Palette, Layout, Type, Image as ImageIcon, Globe, Monitor, Smartphone, Check, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';

export default function HotspotDesign() {
  const [activeView, setActiveView] = useState('desktop');
  const [selectedTheme, setSelectedTheme] = useState('modern');

  const themes = [
    { id: 'modern', name: 'Modern Glass', color: 'bg-indigo-500' },
    { id: 'dark', name: 'Midnight Pro', color: 'bg-slate-900' },
    { id: 'vibrant', name: 'Summer Vibes', color: 'bg-orange-500' },
    { id: 'minimal', name: 'Pure White', color: 'bg-white' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Portal Design</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Customize the look and feel of your captive portal</p>
        </div>
        <div className="flex bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-1 shadow-sm">
          <button
            onClick={() => setActiveView('desktop')}
            className={`p-2 rounded-lg transition-all ${activeView === 'desktop' ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
          >
            <Monitor className="w-5 h-5" />
          </button>
          <button
            onClick={() => setActiveView('mobile')}
            className={`p-2 rounded-lg transition-all ${activeView === 'mobile' ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
          >
            <Smartphone className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Editor sidebar */}
        <div className="lg:col-span-4 space-y-4">
          <Card className="border-none shadow-md dark:bg-slate-900">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 flex items-center gap-2">
                <Palette className="w-4 h-4" /> Appearance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Selected Theme</label>
                <div className="grid grid-cols-2 gap-2">
                  {themes.map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => setSelectedTheme(theme.id)}
                      className={`relative flex flex-col gap-2 p-3 rounded-xl border-2 transition-all text-left ${selectedTheme === theme.id ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/20' : 'border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 bg-slate-50 dark:bg-slate-850'}`}
                    >
                      <div className={`w-full h-8 rounded-md ${theme.color} shadow-sm border border-black/5`} />
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{theme.name}</span>
                      {selectedTheme === theme.id && (
                        <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <Button className="w-full h-11 text-sm bg-indigo-600 hover:bg-indigo-700">
                  Save Changes
                </Button>
              </div>
            </CardContent>
          </Card>
 
          <Card className="border-none shadow-md dark:bg-slate-900">
            <CardContent className="p-0">
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                <button className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                      <ImageIcon className="w-4 h-4" />
                    </div>
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Branding & Logo</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                </button>
                <button className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400">
                      <Type className="w-4 h-4" />
                    </div>
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Messaging & Text</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                </button>
                <button className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400">
                      <Layout className="w-4 h-4" />
                    </div>
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Page Structure</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                </button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Preview area */}
        <div className="lg:col-span-8 flex flex-col items-center justify-center p-8 bg-slate-100 dark:bg-slate-950 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800">
          <motion.div
            layout
            className={`bg-white dark:bg-white shadow-2xl overflow-hidden rounded-3xl border-8 border-slate-200 dark:border-slate-800 transition-all ${activeView === 'mobile' ? 'w-[320px] aspect-[9/18]' : 'w-full aspect-video'}`}
          >
            {/* Mock Portal Header */}
            <div className={`h-1.5 w-full ${themes.find(t => t.id === selectedTheme)?.color}`} />
            <div className="p-8 h-full flex flex-col items-center justify-center bg-slate-50">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-6 shadow-xl">
                <Globe className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 text-center mb-2">Welcome to VIBELINK</h2>
              <p className="text-slate-500 text-sm text-center mb-8 max-w-[240px]">High-speed internet access at your fingertips. Enter your voucher to connect.</p>
              
              <div className="w-full max-w-[280px] space-y-4">
                <input
                  type="text"
                  placeholder="Voucher Code"
                  className="w-full px-5 py-3 rounded-2xl border-2 border-slate-200 text-center text-lg font-bold tracking-[0.2em] outline-none focus:border-indigo-500 transition-all"
                />
                <button className={`w-full py-4 rounded-2xl text-white font-black shadow-lg shadow-indigo-200 ${themes.find(t => t.id === selectedTheme)?.color}`}>
                  CONNECT NOW
                </button>
              </div>

              <div className="mt-12 flex items-center gap-2">
                <div className="h-[2px] w-12 bg-slate-200" />
                <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Powered by Vibelink</span>
                <div className="h-[2px] w-12 bg-slate-200" />
              </div>
            </div>
          </motion.div>
          <div className="mt-4 flex items-center gap-2 text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-800 shadow-sm">
            <span className="text-xs font-bold uppercase tracking-wider">Live Preview</span>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Button({ children, className = '', ...props }) {
  return (
    <button className={`inline-flex items-center justify-center rounded-xl font-bold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 text-white bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-200 dark:shadow-none ring-indigo-500 ${className}`} {...props}>
      {children}
    </button>
  );
}
