import React, { useState } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Zap,
  RefreshCw,
  Brain,
  User,
  AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AITicketCategorizer({ subject, description, customerId, onCategorize }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const analyzeTicket = async () => {
    if (!subject || !description) return;

    setLoading(true);
    try {
      const response = await vibelink.functions.invoke('intelligentTicketAnalysis', {
        subject,
        description,
        customer_id: customerId,
      });

      if (response.data?.analysis) {
        setAnalysis(response.data.analysis);
        onCategorize?.(response.data.analysis);
        setExpanded(true);
      }
    } catch (error) {
      console.error('Failed to analyze ticket:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-red-800';
      case 'high':
        return 'bg-orange-100 text-orange-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-blue-100 text-blue-800';
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'billing':
        return '💳';
      case 'technical':
        return '🔧';
      case 'service_request':
        return '📋';
      case 'complaint':
        return '⚠️';
      default:
        return '❓';
    }
  };

  if (!analysis && !loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Button
          onClick={analyzeTicket}
          variant="outline"
          className="w-full gap-2 border-indigo-200 text-indigo-600 hover:bg-indigo-50"
          disabled={!subject || !description}
        >
          <Brain className="w-4 h-4" />
          Analyze with AI
        </Button>
      </motion.div>
    );
  }

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center gap-3"
      >
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600" />
        <span className="text-sm font-medium text-indigo-700">Analyzing ticket with AI...</span>
      </motion.div>
    );
  }

  if (!analysis) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full"
    >
      <Card className="border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50">
        <CardHeader
          className="cursor-pointer pb-3"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-200 flex items-center justify-center">
                <Zap className="w-4 h-4 text-indigo-700" />
              </div>
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  AI Analysis Result
                  <Badge className={getPriorityColor(analysis.priority)}>
                    {analysis.priority?.toUpperCase()}
                  </Badge>
                </CardTitle>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-indigo-600">{analysis.confidence}%</div>
              <div className="text-xs text-slate-600 dark:text-slate-400">Confidence</div>
            </div>
          </div>
        </CardHeader>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <CardContent className="pt-0 space-y-4">
                {/* Category */}
                <div className="flex items-start gap-3">
                  <div className="text-2xl mt-1">{getCategoryIcon(analysis.category)}</div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Category</p>
                    <p className="text-base font-bold text-slate-900 dark:text-slate-50 capitalize">
                      {analysis.category?.replace('_', ' ')}
                    </p>
                  </div>
                </div>

                {/* Recommended Agent */}
                {analysis.recommended_agent && (
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-emerald-200">
                    <div className="flex items-center gap-2 mb-1">
                      <User className="w-4 h-4 text-emerald-600" />
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Recommended Assignment</p>
                    </div>
                    <p className="text-base font-bold text-emerald-700">
                      {analysis.recommended_agent_name || analysis.recommended_agent}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      Auto-assignment ready based on expertise match
                    </p>
                  </div>
                )}

                {/* Escalation Flag */}
                {analysis.requires_escalation && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-amber-900">Requires Escalation</p>
                      <p className="text-xs text-amber-700">This ticket needs manager review</p>
                    </div>
                  </div>
                )}

                {/* Key Issues */}
                {analysis.key_issues && analysis.key_issues.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Identified Issues</p>
                    <ul className="space-y-1">
                      {analysis.key_issues.map((issue, idx) => (
                        <li key={idx} className="text-sm text-slate-600 dark:text-slate-400 flex items-start gap-2">
                          <span className="text-indigo-600 mt-0.5">•</span>
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Reasoning */}
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">AI Reasoning</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{analysis.reasoning}</p>
                </div>

                {/* Re-analyze Button */}
                <Button
                  onClick={analyzeTicket}
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                >
                  <RefreshCw className="w-3 h-3" />
                  Re-analyze
                </Button>
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}