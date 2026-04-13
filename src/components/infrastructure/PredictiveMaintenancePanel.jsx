import React, { useState, useEffect } from 'react';
import { vibelink } from '@/api/vibelinkClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  Zap,
  RefreshCw,
  Clock,
  TrendingDown,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';

export default function PredictiveMaintenancePanel() {
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    loadPredictions();
  }, []);

  const loadPredictions = async () => {
    setLoading(true);
    try {
      const response = await vibelink.functions.invoke('predictMaintenanceNeeds', {});
      if (response.data?.predictions) {
        setPredictions(response.data.predictions);
        setLastRun(new Date());
      }
    } catch (error) {
      console.error('Failed to load predictions:', error);
    } finally {
      setLoading(false);
    }
  };

  const getUrgencyColor = (urgency) => {
    switch (urgency) {
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default:
        return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  const getUrgencyIcon = (urgency) => {
    switch (urgency) {
      case 'critical':
      case 'high':
        return <AlertTriangle className="w-4 h-4" />;
      case 'medium':
        return <AlertCircle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const criticalCount = predictions.filter(p => p.urgency === 'critical').length;
  const highCount = predictions.filter(p => p.urgency === 'high').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <Card className="border-amber-200">
        <CardHeader 
          className="cursor-pointer bg-gradient-to-r from-amber-50 to-orange-50 pb-3"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <Zap className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  Predictive Maintenance
                  {criticalCount > 0 && (
                    <Badge className="bg-red-600 text-white">{criticalCount} Critical</Badge>
                  )}
                  {highCount > 0 && (
                    <Badge className="bg-orange-600 text-white">{highCount} High</Badge>
                  )}
                </CardTitle>
                {lastRun && (
                  <p className="text-xs text-slate-500 mt-1">
                    Last analyzed: {format(lastRun, 'MMM d, HH:mm')}
                  </p>
                )}
              </div>
            </div>
            <Button
              onClick={loadPredictions}
              size="icon"
              variant="ghost"
              disabled={loading}
              className={loading ? 'animate-spin' : ''}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
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
              <CardContent className="pt-4 space-y-3">
                {predictions.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
                    <p className="text-slate-600 dark:text-slate-400">All equipment healthy</p>
                    <p className="text-xs text-slate-500 mt-1">No maintenance issues predicted</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {predictions.map((pred, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className={`p-3 rounded-lg border-2 ${getUrgencyColor(pred.urgency)}`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 flex-1">
                              {getUrgencyIcon(pred.urgency)}
                              <div className="flex-1">
                                <p className="font-semibold text-sm">{pred.device_name}</p>
                                <p className="text-xs mt-1">{pred.predicted_issue}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold">{pred.risk_score}%</p>
                              <p className="text-xs opacity-75">Risk</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-4 text-xs opacity-85 ml-6">
                            <span className="flex items-center gap-1">
                              <TrendingDown className="w-3 h-3" />
                              {pred.estimated_days_to_failure} days
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {pred.urgency}
                            </span>
                          </div>

                          <p className="text-xs opacity-90 ml-6 italic">
                            {pred.recommended_action}
                          </p>

                          {pred.details && (
                            <p className="text-xs opacity-75 ml-6">{pred.details}</p>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}

                <Button
                  onClick={loadPredictions}
                  variant="outline"
                  className="w-full mt-4"
                  disabled={loading}
                >
                  {loading ? 'Analyzing...' : 'Re-analyze Equipment'}
                </Button>
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}