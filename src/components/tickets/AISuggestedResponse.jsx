import React, { useState } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Zap, 
  Copy, 
  Check, 
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Send,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AISuggestedResponse({ ticket, onApplyResponse, onAutoResolve }) {
  const [aiResponse, setAiResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const generateResponse = async () => {
    setLoading(true);
    try {
      const response = await vibelink.functions.invoke('generateAITicketResponse', {
        ticket_id: ticket.id,
      });

      if (response.data?.response) {
        setAiResponse(response.data.response);
      }
    } catch (error) {
      console.error('Failed to generate AI response:', error);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(aiResponse.suggested_response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getConfidenceColor = (score) => {
    if (score >= 80) return 'bg-green-100 text-green-800';
    if (score >= 60) return 'bg-yellow-100 text-yellow-800';
    return 'bg-orange-100 text-orange-800';
  };

  const getConfidenceLabel = (score) => {
    if (score >= 80) return 'High';
    if (score >= 60) return 'Medium';
    return 'Low';
  };

  if (!aiResponse && !loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4"
      >
        <Button
          onClick={generateResponse}
          variant="outline"
          className="w-full gap-2"
          disabled={loading}
        >
          <Zap className="w-4 h-4" />
          Generate AI Suggestion
        </Button>
      </motion.div>
    );
  }

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="mb-4 p-4 bg-slate-50 rounded-lg flex items-center gap-2 text-slate-600"
      >
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600" />
        <span className="text-sm">Analyzing ticket with AI...</span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4"
    >
      <Card className="border-indigo-200">
        <CardHeader 
          className="cursor-pointer flex flex-row items-center justify-between bg-gradient-to-r from-indigo-50 to-purple-50 pb-3"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-indigo-600" />
            <CardTitle className="text-base">AI-Suggested Response</CardTitle>
            <Badge className={getConfidenceColor(aiResponse.confidence_score)}>
              {getConfidenceLabel(aiResponse.confidence_score)} Confidence ({aiResponse.confidence_score}%)
            </Badge>
          </div>
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </CardHeader>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <CardContent className="pt-4 space-y-4">
                {/* Suggested Response */}
                <div>
                  <label className="text-sm font-semibold text-slate-900 block mb-2">
                    Suggested Response
                  </label>
                  <div className="bg-slate-50 p-4 rounded-lg text-sm text-slate-700 whitespace-pre-wrap">
                    {aiResponse.suggested_response}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={copyToClipboard}
                    className="mt-2"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy Response
                      </>
                    )}
                  </Button>
                </div>

                {/* Recommended Actions */}
                {aiResponse.recommended_actions && aiResponse.recommended_actions.length > 0 && (
                  <div>
                    <label className="text-sm font-semibold text-slate-900 block mb-2">
                      Recommended Actions
                    </label>
                    <ul className="space-y-2">
                      {aiResponse.recommended_actions.map((action, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                          <AlertCircle className="w-4 h-4 mt-0.5 text-indigo-600 flex-shrink-0" />
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Auto-Resolution Info */}
                {aiResponse.should_auto_resolve && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="text-sm font-medium text-green-900 flex items-center gap-2">
                      <Check className="w-4 h-4" />
                      This ticket can be auto-resolved with high confidence
                    </p>
                    <p className="text-xs text-green-800 mt-1">
                      Suggested Resolution: {aiResponse.suggested_resolution}
                    </p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => onApplyResponse?.(aiResponse.suggested_response)}
                    className="flex-1 gap-2"
                    size="sm"
                  >
                    <Send className="w-4 h-4" />
                    Send Response
                  </Button>
                  {aiResponse.should_auto_resolve && (
                    <Button
                      onClick={() => onAutoResolve?.(aiResponse.suggested_resolution)}
                      variant="outline"
                      className="flex-1 gap-2"
                      size="sm"
                    >
                      <Check className="w-4 h-4" />
                      Auto-Resolve
                    </Button>
                  )}
                  <Button
                    onClick={generateResponse}
                    variant="ghost"
                    size="sm"
                    className="gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}