import React, { useState } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Zap } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

export default function ApplyTemplateDialog({ open, onOpenChange, templates, routers }) {
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedRouters, setSelectedRouters] = useState([]);
  const queryClient = useQueryClient();

  const applyMutation = useMutation({
    mutationFn: () =>
      vibelink.functions.invoke('applyMikrotikTemplate', {
        templateId: selectedTemplate.id,
        routerIds: selectedRouters,
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['templates', 'mikrotiks'] });
      toast.success(`Template applied to ${selectedRouters.length} router(s)`);
      onOpenChange(false);
      setSelectedTemplate(null);
      setSelectedRouters([]);
    },
    onError: (error) => {
      toast.error('Failed to apply template: ' + error.message);
    },
  });

  const handleApply = () => {
    if (!selectedTemplate) {
      toast.error('Please select a template');
      return;
    }
    if (selectedRouters.length === 0) {
      toast.error('Please select at least one router');
      return;
    }
    applyMutation.mutate();
  };

  const toggleRouter = (routerId) => {
    setSelectedRouters(prev =>
      prev.includes(routerId)
        ? prev.filter(id => id !== routerId)
        : [...prev, routerId]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Apply Configuration Template
          </DialogTitle>
          <DialogDescription>
            Select a template and the routers to apply it to
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Template Selection */}
          <div className="space-y-3">
            <Label>Select Template *</Label>
            {templates.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">No templates available. Create one first.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {templates.map(template => (
                  <motion.div key={template.id} whileHover={{ scale: 1.01 }}>
                    <Card
                      className={`p-4 cursor-pointer border-2 transition-all ${
                        selectedTemplate?.id === template.id
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      }`}
                      onClick={() => setSelectedTemplate(template)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-medium">{template.template_name}</p>
                          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                            {template.description}
                          </p>
                          <div className="flex gap-2 mt-2">
                            <span className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded capitalize">
                              {template.category.replace(/_/g, ' ')}
                            </span>
                            <span className="text-xs text-slate-500">
                              v{template.version}
                            </span>
                            <span className="text-xs text-slate-500">
                              Used {template.usage_count} time(s)
                            </span>
                          </div>
                        </div>
                        <input
                          type="radio"
                          checked={selectedTemplate?.id === template.id}
                          onChange={() => {}}
                          className="w-4 h-4 mt-1"
                        />
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Router Selection */}
          <div className="space-y-3">
            <Label>Select Routers to Apply To *</Label>
            {routers.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">No routers available.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {routers.map(router => (
                  <div
                    key={router.id}
                    className="p-3 border rounded-lg hover:bg-slate-50 flex items-center gap-3 cursor-pointer"
                    onClick={() => toggleRouter(router.id)}
                  >
                    <Checkbox
                      checked={selectedRouters.includes(router.id)}
                      onChange={() => {}}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{router.router_name}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{router.ip_address}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${
                      router.status === 'online'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}>
                      {router.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {selectedRouters.length > 0 && (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {selectedRouters.length} router(s) selected
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={!selectedTemplate || selectedRouters.length === 0 || applyMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {applyMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                Apply Template
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}