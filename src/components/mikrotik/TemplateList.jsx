import React from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Edit2, Trash2, Copy, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { format } from 'date-fns';
import EmptyState from '@/components/shared/EmptyState';

export default function TemplateList({ onEdit, onApply }) {
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => vibelink.entities.MikrotikConfigTemplate.list(),
  });

  const { data: applications = [] } = useQuery({
    queryKey: ['templateApplications'],
    queryFn: () => vibelink.entities.MikrotikTemplateApplication.filter({ status: 'applied' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (templateId) =>
      vibelink.entities.MikrotikConfigTemplate.delete(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template deleted');
    },
    onError: (error) => {
      toast.error('Failed to delete: ' + error.message);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: (template) =>
      vibelink.entities.MikrotikConfigTemplate.create({
        ...template,
        template_name: `${template.template_name} (Copy)`,
        version: template.version + 1,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template duplicated');
    },
    onError: (error) => {
      toast.error('Failed to duplicate: ' + error.message);
    },
  });

  const getApplicationCount = (templateId) => {
    return applications.filter(app => app.template_id === templateId).length;
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (templates.length === 0) {
    return <EmptyState
      icon={Clock}
      title="No Templates Yet"
      description="Create your first configuration template to get started"
      actionLabel="Create Template"
      onAction={() => onEdit(null)}
    />;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {templates.map((template, idx) => (
        <motion.div
          key={template.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.05 }}
        >
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-base">{template.template_name}</CardTitle>
                  <p className="text-xs text-slate-600 mt-2 line-clamp-2">
                    {template.description}
                  </p>
                </div>
                {!template.is_active && (
                  <Badge variant="outline" className="bg-slate-100">
                    Inactive
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="flex-1 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="capitalize text-xs">
                  {template.category.replace(/_/g, ' ')}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  v{template.version}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-50 p-2 rounded">
                  <p className="text-slate-600">Usage</p>
                  <p className="font-semibold">{getApplicationCount(template.id)}</p>
                </div>
                <div className="bg-slate-50 p-2 rounded">
                  <p className="text-slate-600">Created</p>
                  <p className="font-semibold text-xs">
                    {format(new Date(template.created_date), 'MMM d')}
                  </p>
                </div>
              </div>

              {template.tags && template.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {template.tags.slice(0, 3).map(tag => (
                    <span key={tag} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                      {tag}
                    </span>
                  ))}
                  {template.tags.length > 3 && (
                    <span className="text-xs text-slate-500">+{template.tags.length - 3}</span>
                  )}
                </div>
              )}
            </CardContent>

            <div className="border-t p-3 flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onApply(template)}
                disabled={!template.is_active}
                className="flex-1"
              >
                Apply
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(template)}
              >
                <Edit2 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => duplicateMutation.mutate(template)}
                disabled={duplicateMutation.isPending}
              >
                <Copy className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm('Delete this template?')) {
                    deleteMutation.mutate(template.id);
                  }
                }}
                disabled={deleteMutation.isPending}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}