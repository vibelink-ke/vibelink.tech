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
import { Card } from '@/components/ui/card';
import { Loader2, Wifi, Plus, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

export default function DeviceDiscoveryDialog({ open, onOpenChange }) {
  const [networkRange, setNetworkRange] = useState('192.168.1.0/24');
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [selectedDevices, setSelectedDevices] = useState([]);
  const queryClient = useQueryClient();

  const discoverMutation = useMutation({
    mutationFn: (range) =>
      vibelink.functions.invoke('discoverMikrotikDevices', { networkRange: range }),
    onSuccess: (response) => {
      setDiscoveredDevices(response.data.devices || []);
      toast.success(`Found ${response.data.devicesFound} potential device(s)`);
    },
    onError: (error) => {
      toast.error('Discovery failed: ' + error.message);
    },
  });

  const addDevicesMutation = useMutation({
    mutationFn: () =>
      Promise.all(
        selectedDevices.map(device =>
          vibelink.entities.Mikrotik.create({
            router_name: device.router_name,
            ip_address: device.ip_address,
            mac_address: device.mac_address,
            status: 'online',
            bandwidth_limit: 100,
          })
        )
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotiks'] });
      toast.success(`Added ${selectedDevices.length} router(s)`);
      onOpenChange(false);
      setDiscoveredDevices([]);
      setSelectedDevices([]);
    },
    onError: (error) => {
      toast.error('Failed to add devices: ' + error.message);
    },
  });

  const handleDiscover = () => {
    if (!networkRange) {
      toast.error('Please enter a network range');
      return;
    }
    discoverMutation.mutate(networkRange);
  };

  const toggleDevice = (deviceIp) => {
    setSelectedDevices(prev =>
      prev.includes(deviceIp)
        ? prev.filter(ip => ip !== deviceIp)
        : [...prev, deviceIp]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wifi className="w-5 h-5" />
            Discover MikroTik Devices
          </DialogTitle>
          <DialogDescription>
            Scan your network to automatically detect MikroTik routers
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Network Range Input */}
          <div className="space-y-2">
            <Label>Network Range (CIDR)</Label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g., 192.168.1.0/24"
                value={networkRange}
                onChange={(e) => setNetworkRange(e.target.value)}
                disabled={discoverMutation.isPending}
              />
              <Button
                onClick={handleDiscover}
                disabled={discoverMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {discoverMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Wifi className="w-4 h-4 mr-2" />
                    Discover
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Enter the network range to scan (e.g., 192.168.1.0/24 for 192.168.1.0-255)
            </p>
          </div>

          {/* Discovered Devices */}
          {discoveredDevices.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between">
                <Label>Found {discoveredDevices.length} Device(s)</Label>
                {selectedDevices.length > 0 && (
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {selectedDevices.length} selected
                  </span>
                )}
              </div>

              <div className="max-h-64 overflow-y-auto space-y-2">
                {discoveredDevices.map((device, idx) => (
                  <motion.div
                    key={device.ip_address}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                  >
                    <Card
                      className="p-3 cursor-pointer border hover:border-indigo-400 transition-all"
                      onClick={() => toggleDevice(device.ip_address)}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedDevices.includes(device.ip_address)}
                          onChange={() => {}}
                          className="w-4 h-4"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm">{device.router_name}</p>
                            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                              <span className="text-xs text-slate-600 dark:text-slate-400">
                                {device.confidence}% confidence
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400">{device.ip_address}</p>
                          <p className="text-xs text-slate-500">{device.mac_address}</p>
                        </div>
                        {selectedDevices.includes(device.ip_address) ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {discoveredDevices.length === 0 && !discoverMutation.isPending && (
            <div className="text-center py-8 text-slate-500">
              <Wifi className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Enter a network range and click Discover to find devices</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => addDevicesMutation.mutate()}
            disabled={selectedDevices.length === 0 || addDevicesMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {addDevicesMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Add {selectedDevices.length} Router{selectedDevices.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}