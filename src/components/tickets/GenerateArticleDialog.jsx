import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { Sparkles, Loader2, Check, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

export default function GenerateArticleDialog({ ticket, open, onOpenChange }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    category: 'general',
    tags: '',
  });
  const queryClient = useQueryClient();

  const createArticleMutation = useMutation({
    mutationFn: (data) => vibelink.entities.KnowledgeBase.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['knowledge-base']);
      toast.success('Knowledge base article created!');
      onOpenChange(false);
      resetForm();
    },
  });

  const resetForm = () => {
    setGeneratedContent(null);
    setFormData({ title: '', category: 'general', tags: '' });
  };

  const handleGenerate = async () => {
    if (!ticket.resolution) return;

    setIsGenerating(true);
    try {
      const result = await vibelink.integrations.Core.InvokeLLM({
        prompt: `Create a knowledge base article based on this resolved support ticket:

Ticket Subject: ${ticket.subject}
Category: ${ticket.category}
Customer Issue: ${ticket.description}
Resolution: ${ticket.resolution}

Generate a comprehensive, well-structured help article that:
1. Has a clear, descriptive title
2. Explains the problem/issue
3. Provides step-by-step solution
4. Includes any relevant tips or warnings
5. Uses markdown formatting (headings, lists, bold, etc.)

Make it professional and helpful for future customers with similar issues.`,
        response_json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" },
            suggested_tags: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      setGeneratedContent(result.content);
      setFormData({
        title: result.title || ticket.subject,
        category: ticket.category || 'general',
        tags: result.suggested_tags?.join(', ') || '',
      });
    } catch (error) {
      console.error('Failed to generate article:', error);
      toast.error('Failed to generate article');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = () => {
    const slug = formData.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    createArticleMutation.mutate({
      title: formData.title,
      slug,
      content: generatedContent,
      category: formData.category,
      tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
      status: 'draft',
      order: 0,
    });
  };

  React.useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open]);

  if (!ticket) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-500" />
            Generate Knowledge Base Article
          </DialogTitle>
          <DialogDescription>
            Create a help article from this resolved ticket using AI
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {!generatedContent ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-indigo-600" />
              </div>
              <h3 className="font-semibold text-slate-900 mb-2">Ready to Generate</h3>
              <p className="text-sm text-slate-600 mb-4 max-w-md mx-auto">
                Our AI will analyze the ticket resolution and create a comprehensive help article
              </p>
              <Button
                onClick={handleGenerate}
                disabled={isGenerating || !ticket.resolution}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Article
                  </>
                )}
              </Button>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                <span className="text-sm text-emerald-700 font-medium">Article generated successfully!</span>
              </div>

              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData({...formData, title: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={formData.category} onValueChange={(v) => setFormData({...formData, category: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="billing">Billing</SelectItem>
                      <SelectItem value="technical">Technical</SelectItem>
                      <SelectItem value="account">Account</SelectItem>
                      <SelectItem value="network">Network</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Tags (comma separated)</Label>
                  <Input
                    value={formData.tags}
                    onChange={(e) => setFormData({...formData, tags: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Generated Content (Markdown)</Label>
                <Textarea
                  value={generatedContent}
                  onChange={(e) => setGeneratedContent(e.target.value)}
                  rows={12}
                  className="font-mono text-sm"
                />
              </div>

              <div className="flex justify-between gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Regenerate
                </Button>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={createArticleMutation.isPending}
                    className="bg-indigo-600 hover:bg-indigo-700"
                  >
                    {createArticleMutation.isPending ? 'Saving...' : 'Save as Draft'}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}