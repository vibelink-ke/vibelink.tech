import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { 
  BookOpen,
  Plus,
  Edit2,
  Trash2,
  Eye,
  CheckCircle,
  ThumbsUp,
  ThumbsDown,
  Tag,
  Filter
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import SearchInput from '@/components/shared/SearchInput';
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
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import StatusBadge from '@/components/shared/StatusBadge';
import ReactMarkdown from 'react-markdown';

const categoryColors = {
  billing: 'bg-purple-50 text-purple-700 border-purple-200',
  technical: 'bg-blue-50 text-blue-700 border-blue-200',
  account: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  network: 'bg-amber-50 text-amber-700 border-amber-200',
  general: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
};

export default function KnowledgeBase() {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editingArticle, setEditingArticle] = useState(null);
  const [viewArticle, setViewArticle] = useState(null);
  const [isAISearching, setIsAISearching] = useState(false);
  const [aiSearchResults, setAiSearchResults] = useState(null);
  const queryClient = useQueryClient();

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['knowledge-base'],
    queryFn: () => vibelink.entities.KnowledgeBase.list('-order', 100),
  });

  const createMutation = useMutation({
    mutationFn: (data) => vibelink.entities.KnowledgeBase.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['knowledge-base']);
      setShowForm(false);
      setEditingArticle(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => vibelink.entities.KnowledgeBase.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['knowledge-base']);
      setShowForm(false);
      setEditingArticle(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => vibelink.entities.KnowledgeBase.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['knowledge-base']),
  });

  // AI-powered semantic search
  const performAISearch = async (query) => {
    if (!query || query.length < 3) {
      setAiSearchResults(null);
      return;
    }

    setIsAISearching(true);
    try {
      const articlesContext = articles.map(a => ({
        id: a.id,
        title: a.title,
        category: a.category,
        tags: a.tags || [],
        content_snippet: a.content?.substring(0, 300)
      }));

      const result = await vibelink.integrations.Core.InvokeLLM({
        prompt: `Given this natural language search query: "${query}"

And these knowledge base articles:
${JSON.stringify(articlesContext, null, 2)}

Identify articles that semantically match the user's intent, even if exact keywords don't match. Consider synonyms, related concepts, and context. Return the IDs of relevant articles ranked by relevance.`,
        response_json_schema: {
          type: "object",
          properties: {
            relevant_article_ids: {
              type: "array",
              items: { type: "string" }
            },
            search_interpretation: { type: "string" }
          }
        }
      });

      setAiSearchResults(result);
    } catch (error) {
      console.error('AI search failed:', error);
      setAiSearchResults(null);
    } finally {
      setIsAISearching(false);
    }
  };

  React.useEffect(() => {
    const debounce = setTimeout(() => {
      if (searchQuery && searchQuery.length >= 3) {
        performAISearch(searchQuery);
      } else {
        setAiSearchResults(null);
      }
    }, 800);
    return () => clearTimeout(debounce);
  }, [searchQuery, articles]);

  const filteredArticles = React.useMemo(() => {
    // If AI search has results, use those
    if (aiSearchResults?.relevant_article_ids) {
      const aiResults = aiSearchResults.relevant_article_ids
        .map(id => articles.find(a => a.id === id))
        .filter(Boolean);
      
      // Apply category filter to AI results
      return categoryFilter === 'all' 
        ? aiResults 
        : aiResults.filter(a => a.category === categoryFilter);
    }

    // Otherwise use traditional keyword search
    return articles.filter(article => {
      const matchesSearch = !searchQuery || 
        article.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        article.content?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        article.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCategory = categoryFilter === 'all' || article.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [articles, searchQuery, categoryFilter, aiSearchResults]);

  const publishedArticles = filteredArticles.filter(a => a.status === 'published');
  const draftArticles = filteredArticles.filter(a => a.status === 'draft');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Knowledge Base"
          subtitle={`${publishedArticles.length} published articles`}
          actionLabel="Create Article"
          actionIcon={Plus}
          onAction={() => { setEditingArticle(null); setShowForm(true); }}
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-indigo-600">{publishedArticles.length}</p>
                <p className="text-sm text-slate-500">Published</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-amber-600">{draftArticles.length}</p>
                <p className="text-sm text-slate-500">Drafts</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-emerald-600">
                  {articles.reduce((sum, a) => sum + (a.views || 0), 0)}
                </p>
                <p className="text-sm text-slate-500">Total Views</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-purple-600">5</p>
                <p className="text-sm text-slate-500">Categories</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 max-w-md">
            <div className="relative">
              <SearchInput 
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search articles (AI-powered)..."
              />
              {isAISearching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  >
                    <Sparkles className="w-4 h-4 text-indigo-500" />
                  </motion.div>
                </div>
              )}
            </div>
            {aiSearchResults?.search_interpretation && (
              <motion.p
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xs text-indigo-600 mt-1 flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3" />
                {aiSearchResults.search_interpretation}
              </motion.p>
            )}
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-40 bg-white dark:bg-slate-900">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="billing">Billing</SelectItem>
              <SelectItem value="technical">Technical</SelectItem>
              <SelectItem value="account">Account</SelectItem>
              <SelectItem value="network">Network</SelectItem>
              <SelectItem value="general">General</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-48 bg-white dark:bg-slate-900 rounded-2xl animate-pulse" />)}
          </div>
        ) : filteredArticles.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No articles found"
            description="Create your first knowledge base article"
            actionLabel="Create Article"
            onAction={() => setShowForm(true)}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredArticles.map((article, index) => (
              <motion.div
                key={article.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className="hover:shadow-lg transition-all cursor-pointer h-full" onClick={() => setViewArticle(article)}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <CardTitle className="text-lg line-clamp-2">{article.title}</CardTitle>
                        <div className="flex gap-2 mt-2">
                          <Badge variant="outline" className={categoryColors[article.category]}>
                            {article.category}
                          </Badge>
                          {article.status === 'draft' ? (
                            <Badge variant="outline">Draft</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Published
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button 
                          size="icon" 
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); setEditingArticle(article); setShowForm(true); }}
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost"
                          className="text-rose-500"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('Delete this article?')) {
                              deleteMutation.mutate(article.id);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-3 mb-3">
                      {article.content?.substring(0, 150)}...
                    </p>
                    
                    {article.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {article.tags.slice(0, 3).map((tag, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs text-slate-500 pt-3 border-t">
                      <span className="flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        {article.views || 0} views
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1 text-emerald-600">
                          <ThumbsUp className="w-3 h-3" />
                          {article.helpful_count || 0}
                        </span>
                        <span className="flex items-center gap-1 text-slate-400">
                          <ThumbsDown className="w-3 h-3" />
                          {article.not_helpful_count || 0}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        <ArticleFormDialog
          open={showForm}
          onOpenChange={setShowForm}
          article={editingArticle}
          onSubmit={(data) => {
            if (editingArticle) {
              updateMutation.mutate({ id: editingArticle.id, data });
            } else {
              createMutation.mutate(data);
            }
          }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />

        <ArticleViewDialog
          article={viewArticle}
          open={!!viewArticle}
          onOpenChange={(open) => !open && setViewArticle(null)}
          onEdit={() => { setEditingArticle(viewArticle); setShowForm(true); setViewArticle(null); }}
        />
      </div>
    </div>
  );
}

function ArticleFormDialog({ open, onOpenChange, article, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    category: 'general',
    tags: '',
    status: 'draft',
    order: 0,
  });

  React.useEffect(() => {
    if (article) {
      setFormData({
        title: article.title || '',
        content: article.content || '',
        category: article.category || 'general',
        tags: article.tags?.join(', ') || '',
        status: article.status || 'draft',
        order: article.order || 0,
      });
    } else {
      setFormData({
        title: '',
        content: '',
        category: 'general',
        tags: '',
        status: 'draft',
        order: 0,
      });
    }
  }, [article, open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const slug = formData.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    onSubmit({
      title: formData.title,
      slug,
      content: formData.content,
      category: formData.category,
      tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
      status: formData.status,
      order: formData.order,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{article ? 'Edit Article' : 'Create Article'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>Title *</Label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              placeholder="How to configure your router"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category *</Label>
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
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({...formData, status: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tags (comma separated)</Label>
            <Input
              value={formData.tags}
              onChange={(e) => setFormData({...formData, tags: e.target.value})}
              placeholder="router, wifi, setup, troubleshooting"
            />
          </div>

          <div className="space-y-2">
            <Label>Content (Markdown) *</Label>
            <Textarea
              value={formData.content}
              onChange={(e) => setFormData({...formData, content: e.target.value})}
              placeholder="Write your article content using Markdown..."
              rows={12}
              required
              className="font-mono text-sm"
            />
            <p className="text-xs text-slate-500">Supports Markdown formatting</p>
          </div>

          <div className="space-y-2">
            <Label>Display Order</Label>
            <Input
              type="number"
              value={formData.order}
              onChange={(e) => setFormData({...formData, order: Number(e.target.value)})}
              className="max-w-xs"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700">
              {isLoading ? 'Saving...' : article ? 'Update Article' : 'Create Article'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArticleViewDialog({ article, open, onOpenChange, onEdit }) {
  if (!article) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <DialogTitle className="text-2xl">{article.title}</DialogTitle>
              <div className="flex gap-2 mt-2">
                <Badge variant="outline" className={categoryColors[article.category]}>
                  {article.category}
                </Badge>
                <StatusBadge status={article.status} />
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Edit2 className="w-4 h-4 mr-2" />
              Edit
            </Button>
          </div>
        </DialogHeader>

        <div className="mt-6 space-y-6">
          {article.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {article.tags.map((tag, i) => (
                <span key={i} className="flex items-center gap-1 text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-full">
                  <Tag className="w-3 h-3" />
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="prose prose-slate max-w-none">
            <ReactMarkdown>{article.content}</ReactMarkdown>
          </div>

          <div className="flex items-center justify-between pt-4 border-t">
            <div className="flex items-center gap-4 text-sm text-slate-500">
              <span className="flex items-center gap-1">
                <Eye className="w-4 h-4" />
                {article.views || 0} views
              </span>
              <span className="flex items-center gap-1 text-emerald-600">
                <ThumbsUp className="w-4 h-4" />
                {article.helpful_count || 0}
              </span>
              <span className="flex items-center gap-1">
                <ThumbsDown className="w-4 h-4" />
                {article.not_helpful_count || 0}
              </span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}