import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Loader2,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

const ALERT_TYPES = [
  { value: 'cpu_usage', label: 'CPU Usage', unit: '%' },
  { value: 'memory_usage', label: 'Memory Usage', unit: '%' },
  { value: 'disk_space', label: 'Disk Space', unit: '%' },
  { value: 'interface_down', label: 'Interface Down', unit: 'N/A' },
  { value: 'bandwidth_limit', label: 'Bandwidth Limit', unit: 'Mbps' },
];

export default function AlertConfigDialog({
  open,
  onOpenChange,
  routerId,
  routerName,
  config,
}) {
  const [alertType, setAlertType] = useState('cpu_usage');
  const [thresholdValue, setThresholdValue] = useState('80');
  const [durationMinutes, setDurationMinutes] = useState('5');
  const [cooldownMinutes, setCooldownMinutes] = useState('30');
  const [channels, setChannels] = useState(['dashboard']);
  const [emails, setEmails] = useState('');
  const [phones, setPhones] = useState('');
  const [enabled, setEnabled] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (config) {
      setAlertType(config.alert_type);
      setThresholdValue(config.threshold_value?.toString() || '80');
      setDurationMinutes(config.duration_minutes?.toString() || '5');
      setCooldownMinutes(config.cooldown_minutes?.toString() || '30');
      setChannels(config.notification_channels || ['dashboard']);
      setEmails(config.recipient_emails?.join(', ') || '');
      setPhones(config.recipient_phones?.join(', ') || '');
      setEnabled(config.enabled !== false);
    }
  }, [config, open]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = {
        mikrotik_id: routerId,
        mikrotik_name: routerName,
        alert_type: alertType,
        threshold_value: parseFloat(thresholdValue),
        duration_minutes: parseInt(durationMinutes),
        cooldown_minutes: parseInt(cooldownMinutes),
        notification_channels: channels,
        recipient_emails: emails
          .split(',')
          .map(e => e.trim())
          .filter(e => e),
        recipient_phones: phones
          .split(',')
          .map(p => p.trim())
          .filter(p => p),
        enabled,
      };

      if (config?.id) {
        return vibelink.entities.MikrotikAlertConfig.update(config.id, data);
      } else {
        return vibelink.entities.MikrotikAlertConfig.create(data);
      }
    },
    onSuccess: () => {
      toast.success(config ? 'Alert updated' : 'Alert created');
      queryClient.invalidateQueries({ queryKey: ['alert-configs', routerId] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error('Failed to save alert: ' + error.message);
    },
  });

  const handleChannelChange = (channel) => {
    setChannels(prev =>
      prev.includes(channel)
        ? prev.filter(c => c !== channel)
        : [...prev, channel]
    );
  };

  const selectedAlertType = ALERT_TYPES.find(t => t.value === alertType);
  const needsNotification = channels.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {config ? 'Edit Alert Configuration' : 'Create Alert Configuration'}
          </DialogTitle>
          <DialogDescription>
            Configure monitoring alert for {routerName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Enable Toggle */}
          <div className="flex items-center gap-3">
            <Checkbox
              id="enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
            <Label htmlFor="enabled" className="font-medium cursor-pointer">
              Enable this alert
            </Label>
          </div>

          {/* Alert Type */}
          <div className="space-y-2">
            <Label htmlFor="alert-type" className="font-medium">
              Alert Type
            </Label>
            <Select value={alertType} onValueChange={setAlertType}>
              <SelectTrigger id="alert-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALERT_TYPES.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Threshold Value */}
          {selectedAlertType?.value !== 'interface_down' && (
            <div className="space-y-2">
              <Label htmlFor="threshold" className="font-medium">
                Threshold Value ({selectedAlertType?.unit})
              </Label>
              <Input
                id="threshold"
                type="number"
                value={thresholdValue}
                onChange={e => setThresholdValue(e.target.value)}
                placeholder="80"
                min="0"
              />
            </div>
          )}

          {/* Duration */}
          <div className="space-y-2">
            <Label htmlFor="duration" className="font-medium">
              Alert Duration (minutes)
            </Label>
            <Input
              id="duration"
              type="number"
              value={durationMinutes}
              onChange={e => setDurationMinutes(e.target.value)}
              placeholder="5"
              min="1"
            />
            <p className="text-xs text-slate-500">
              Condition must persist for this duration before alerting
            </p>
          </div>

          {/* Cooldown */}
          <div className="space-y-2">
            <Label htmlFor="cooldown" className="font-medium">
              Alert Cooldown (minutes)
            </Label>
            <Input
              id="cooldown"
              type="number"
              value={cooldownMinutes}
              onChange={e => setCooldownMinutes(e.target.value)}
              placeholder="30"
              min="1"
            />
            <p className="text-xs text-slate-500">
              Minimum time before sending another alert of same type
            </p>
          </div>

          {/* Notification Channels */}
          <div className="space-y-3">
            <Label className="font-medium">Notification Channels</Label>
            <div className="space-y-2">
              {[
                { id: 'dashboard', label: 'Dashboard Alert' },
                { id: 'email', label: 'Email Notification' },
                { id: 'sms', label: 'SMS Notification' },
              ].map(ch => (
                <div key={ch.id} className="flex items-center gap-3">
                  <Checkbox
                    id={`channel-${ch.id}`}
                    checked={channels.includes(ch.id)}
                    onCheckedChange={() => handleChannelChange(ch.id)}
                  />
                  <Label
                    htmlFor={`channel-${ch.id}`}
                    className="font-normal cursor-pointer"
                  >
                    {ch.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* Email Recipients */}
          {channels.includes('email') && (
            <div className="space-y-2">
              <Label htmlFor="emails" className="font-medium">
                Email Recipients
              </Label>
              <Input
                id="emails"
                value={emails}
                onChange={e => setEmails(e.target.value)}
                placeholder="admin@example.com, ops@example.com"
              />
              <p className="text-xs text-slate-500">
                Comma-separated email addresses
              </p>
            </div>
          )}

          {/* Phone Recipients */}
          {channels.includes('sms') && (
            <div className="space-y-2">
              <Label htmlFor="phones" className="font-medium">
                Phone Numbers
              </Label>
              <Input
                id="phones"
                value={phones}
                onChange={e => setPhones(e.target.value)}
                placeholder="+254700000000, +254701111111"
              />
              <p className="text-xs text-slate-500">
                Comma-separated phone numbers (E.164 format)
              </p>
            </div>
          )}

          {/* Warning */}
          {channels.length === 1 && channels[0] === 'dashboard' && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-3"
            >
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                Only dashboard alerts enabled. Consider adding email or SMS for critical alerts.
              </p>
            </motion.div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saveMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !enabled}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                {config ? 'Update Alert' : 'Create Alert'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}