import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, ExternalLink, Sparkles, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function AISuggestedArticles({ subject, description, category }) {
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const { data: articles = [] } = useQuery({
    queryKey: ['knowledge-base'],
    queryFn: () => vibelink.entities.KnowledgeBase.filter({ status: 'published' }),
  });

  useEffect(() => {
    const getSuggestions = async () => {
      if (!subject || articles.length === 0) return;

      setIsLoading(true);
      try {
        const articlesContext = articles.map(a => ({
          id: a.id,
          title: a.title,
          category: a.category,
          tags: a.tags || [],
          content_snippet: a.content?.substring(0, 200)
        }));

        const result = await vibelink.integrations.Core.InvokeLLM({
          prompt: `Given this support ticket:
Subject: ${subject}
${description ? `Description: ${description}` : ''}
Category: ${category || 'general'}

And these available knowledge base articles:
${JSON.stringify(articlesContext, null, 2)}

Identify the top 3 most relevant articles that could help resolve this ticket. Return ONLY a JSON array of article IDs in order of relevance.`,
          response_json_schema: {
            type: "object",
            properties: {
              relevant_article_ids: {
                type: "array",
                items: { type: "string" }
              }
            }
          }
        });

        const relevantIds = result.relevant_article_ids || [];
        const suggestedArticles = relevantIds
          .map(id => articles.find(a => a.id === id))
          .filter(Boolean)
          .slice(0, 3);

        setSuggestions(suggestedArticles);
      } catch (error) {
        console.error('Failed to get AI suggestions:', error);
      } finally {
        setIsLoading(false);
      }
    };

    const debounce = setTimeout(getSuggestions, 500);
    return () => clearTimeout(debounce);
  }, [subject, description, category, articles]);

  if (!subject || isLoading) {
    return (
      <Card className="border-indigo-200 bg-indigo-50/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-indigo-900">
            <Sparkles className="w-4 h-4" />
            AI Suggested Articles
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-indigo-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            Finding relevant articles...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (suggestions.length === 0) {
    return null;
  }

  const categoryColors = {
    billing: 'bg-purple-50 text-purple-700 border-purple-200',
    technical: 'bg-blue-50 text-blue-700 border-blue-200',
    account: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    network: 'bg-amber-50 text-amber-700 border-amber-200',
    general: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  };

  return (
    <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/50 to-purple-50/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-indigo-900">
          <Sparkles className="w-4 h-4 text-indigo-500" />
          AI Suggested Help Articles
        </CardTitle>
        <p className="text-xs text-indigo-600">These articles might help resolve this issue</p>
      </CardHeader>
      <CardContent className="space-y-2">
        <AnimatePresence>
          {suggestions.map((article, i) => (
            <motion.div
              key={article.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="p-3 bg-white dark:bg-slate-900 border border-indigo-100 rounded-lg hover:shadow-md transition-all cursor-pointer group"
            >
              <div className="flex items-start gap-3">
                <div className="p-1.5 rounded-md bg-indigo-50 flex-shrink-0">
                  <BookOpen className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 dark:text-slate-50 text-sm group-hover:text-indigo-600 transition-colors">
                    {article.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className={`${categoryColors[article.category]} text-xs`}>
                      {article.category}
                    </Badge>
                    {article.views > 0 && (
                      <span className="text-xs text-slate-500">{article.views} views</span>
                    )}
                  </div>
                </div>
                <ExternalLink className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}