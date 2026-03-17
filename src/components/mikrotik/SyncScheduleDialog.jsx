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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Loader2, Clock } from 'lucide-react';
import { toast } from 'sonner';

export default function SyncScheduleDialog({ open, onOpenChange, routers }) {
  const [selectedRouters, setSelectedRouters] = useState([]);
  const [frequency, setFrequency] = useState('daily');
  const [time, setTime] = useState('02:00');
  const [enabled, setEnabled] = useState(true);

  const queryClient = useQueryClient();

  const scheduleMutation = useMutation({
    mutationFn: (data) =>
      vibelink.functions.invoke('scheduleMikrotikSync', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotiks'] });
      toast.success('Sync schedule created successfully');
      onOpenChange(false);
      setSelectedRouters([]);
    },
    onError: (error) => {
      toast.error('Failed to create schedule: ' + error.message);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (selectedRouters.length === 0) {
      toast.error('Please select at least one router');
      return;
    }

    scheduleMutation.mutate({
      routerIds: selectedRouters,
      frequency,
      time,
      enabled,
    });
  };

  const toggleRouter = (routerId) => {
    setSelectedRouters(prev =>
      prev.includes(routerId)
        ? prev.filter(id => id !== routerId)
        : [...prev, routerId]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Schedule Configuration Sync
          </DialogTitle>
          <DialogDescription>
            Automatically sync configuration for selected routers
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Router Selection */}
          <div className="space-y-3">
            <Label>Select Routers *</Label>
            <div className="max-h-48 overflow-y-auto space-y-2 border rounded-lg p-3">
              {routers.map(router => (
                <div
                  key={router.id}
                  className="flex items-center gap-3 p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded cursor-pointer"
                  onClick={() => toggleRouter(router.id)}
                >
                  <input
                    type="checkbox"
                    checked={selectedRouters.includes(router.id)}
                    onChange={() => {}}
                    className="w-4 h-4"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{router.router_name}</p>
                    <p className="text-xs text-slate-500">{router.ip_address}</p>
                  </div>
                </div>
              ))}
            </div>
            {selectedRouters.length > 0 && (
              <p className="text-xs text-slate-600">
                {selectedRouters.length} router(s) selected
              </p>
            )}
          </div>

          {/* Frequency */}
          <div className="space-y-2">
            <Label>Frequency *</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Every Hour</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Time */}
          <div className="space-y-2">
            <Label>Sync Time (UTC)</Label>
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={scheduleMutation.isPending}>
              {scheduleMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Scheduling...
                </>
              ) : (
                'Schedule Sync'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}