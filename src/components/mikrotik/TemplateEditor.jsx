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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

const categories = ['wifi', 'firewall', 'vpn', 'routing', 'bandwidth_management', 'hotspot', 'general'];

export default function TemplateEditor({ open, onOpenChange, template, onSuccess }) {
  const [formData, setFormData] = useState(
    template || {
      template_name: '',
      description: '',
      category: 'general',
      config_content: '{}',
      is_active: true,
      tags: [],
    }
  );
  const [newTag, setNewTag] = useState('');
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (data) =>
      template?.id
        ? vibelink.entities.MikrotikConfigTemplate.update(template.id, data)
        : vibelink.entities.MikrotikConfigTemplate.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.success(template ? 'Template updated' : 'Template created');
      onOpenChange(false);
      setFormData({
        template_name: '',
        description: '',
        category: 'general',
        config_content: '{}',
        is_active: true,
        tags: [],
      });
      onSuccess?.();
    },
    onError: (error) => {
      toast.error('Failed to save template: ' + error.message);
    },
  });

  const handleAddTag = () => {
    if (newTag.trim()) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()],
      }));
      setNewTag('');
    }
  };

  const handleRemoveTag = (tag) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tag),
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.template_name.trim()) {
      toast.error('Template name is required');
      return;
    }

    try {
      JSON.parse(formData.config_content);
    } catch {
      toast.error('Invalid JSON in configuration content');
      return;
    }

    saveMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? 'Edit Template' : 'Create New Template'}</DialogTitle>
          <DialogDescription>
            {template?.version && <span>Version {template.version}</span>}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Template Name */}
          <div className="space-y-2">
            <Label>Template Name *</Label>
            <Input
              value={formData.template_name}
              onChange={(e) =>
                setFormData({ ...formData, template_name: e.target.value })
              }
              placeholder="e.g., Standard WiFi Setup"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="Describe the purpose of this template"
              rows={3}
            />
          </div>

          {/* Category */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select
                value={formData.category}
                onValueChange={(value) =>
                  setFormData({ ...formData, category: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(cat => (
                    <SelectItem key={cat} value={cat}>
                      {cat.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={formData.is_active ? 'active' : 'inactive'}
                onValueChange={(value) =>
                  setFormData({ ...formData, is_active: value === 'active' })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Configuration Content */}
          <div className="space-y-2">
            <Label>Configuration (JSON) *</Label>
            <Textarea
              value={formData.config_content}
              onChange={(e) =>
                setFormData({ ...formData, config_content: e.target.value })
              }
              placeholder='{"wifi": {"ssid": "MyNetwork", "password": "secure"}}'
              rows={8}
              className="font-mono text-xs"
            />
            <p className="text-xs text-slate-500">
              Enter configuration as valid JSON. This will be applied to routers.
            </p>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                placeholder="Add a tag..."
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleAddTag}
                disabled={!newTag.trim()}
              >
                Add
              </Button>
            </div>
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.tags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => handleRemoveTag(tag)}
                    className="px-2 py-1 text-xs bg-slate-200 text-slate-700 rounded-full hover:bg-slate-300"
                  >
                    {tag} ✕
                  </button>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saveMutation.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  {template ? 'Update' : 'Create'} Template
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}