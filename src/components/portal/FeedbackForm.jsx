import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion } from 'framer-motion';
import { Star, MessageSquare, Send } from 'lucide-react';

export default function FeedbackForm({ customer, ticket, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    type: ticket ? 'ticket_resolution' : 'general',
    csat_score: null,
    nps_score: null,
    category: 'general',
    comment: ''
  });
  const [hoveredStar, setHoveredStar] = useState(null);
  const [hoveredNPS, setHoveredNPS] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      customer_id: customer.id,
      customer_name: customer.full_name,
      customer_email: customer.email,
      ticket_id: ticket?.id,
      ticket_number: ticket?.ticket_number
    });
  };

  const CSATLabels = ['Very Dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very Satisfied'];
  const NPSLabels = ['Not at all likely', '', '', '', '', '', '', '', '', '', 'Extremely likely'];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {ticket && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-900 flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Feedback for ticket: <strong>{ticket.ticket_number}</strong>
          </p>
          <p className="text-xs text-blue-700 mt-1">{ticket.subject}</p>
        </div>
      )}

      {/* CSAT Score */}
      <div className="space-y-3">
        <Label className="text-base">How satisfied are you with our service? *</Label>
        <div className="flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((score) => (
            <motion.button
              key={score}
              type="button"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setFormData({ ...formData, csat_score: score })}
              onMouseEnter={() => setHoveredStar(score)}
              onMouseLeave={() => setHoveredStar(null)}
              className="focus:outline-none"
            >
              <Star
                className={`w-12 h-12 transition-all ${
                  (hoveredStar ? score <= hoveredStar : score <= formData.csat_score)
                    ? 'fill-amber-400 text-amber-400'
                    : 'text-slate-300'
                }`}
              />
            </motion.button>
          ))}
        </div>
        {formData.csat_score && (
          <p className="text-center text-sm text-slate-600 dark:text-slate-400">
            {CSATLabels[formData.csat_score - 1]}
          </p>
        )}
      </div>

      {/* NPS Score */}
      <div className="space-y-3">
        <Label className="text-base">How likely are you to recommend us to a friend? *</Label>
        <div className="grid grid-cols-11 gap-1">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => (
            <motion.button
              key={score}
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setFormData({ ...formData, nps_score: score })}
              onMouseEnter={() => setHoveredNPS(score)}
              onMouseLeave={() => setHoveredNPS(null)}
              className={`h-10 rounded-md text-sm font-medium transition-all ${
                (hoveredNPS !== null ? score <= hoveredNPS : score <= formData.nps_score)
                  ? score <= 6
                    ? 'bg-red-500 text-white'
                    : score <= 8
                    ? 'bg-amber-500 text-white'
                    : 'bg-emerald-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              {score}
            </motion.button>
          ))}
        </div>
        <div className="flex justify-between text-xs text-slate-500 mt-1">
          <span>Not likely</span>
          <span>Extremely likely</span>
        </div>
      </div>

      {/* Category */}
      {!ticket && (
        <div className="space-y-2">
          <Label>Feedback Category</Label>
          <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="support">Customer Support</SelectItem>
              <SelectItem value="service_quality">Service Quality</SelectItem>
              <SelectItem value="billing">Billing</SelectItem>
              <SelectItem value="technical">Technical</SelectItem>
              <SelectItem value="general">General</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Comment */}
      <div className="space-y-2">
        <Label>Additional Comments or Suggestions</Label>
        <Textarea
          value={formData.comment}
          onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
          placeholder="Tell us more about your experience or share your suggestions..."
          rows={4}
        />
      </div>

      <div className="flex justify-end gap-3 pt-4">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button 
          type="submit" 
          disabled={!formData.csat_score || !formData.nps_score}
          className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
        >
          <Send className="w-4 h-4 mr-2" />
          Submit Feedback
        </Button>
      </div>
    </form>
  );
}