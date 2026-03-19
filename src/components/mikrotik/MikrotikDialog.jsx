import React, { useState, useEffect } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function MikrotikDialog({ open, onOpenChange, router }) {
  const [formData, setFormData] = useState({
    router_name: '',
    ip_address: '',
    mac_address: '',
    api_port: 8728,
    username: '',
    password: '',
    vpn_enabled: true,
    vpn_protocol: 'wireguard',
    vpn_server: '',
    vpn_port: '',
    vpn_username: '',
    vpn_password: '',
    bandwidth_limit: '',
    notes: '',
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    if (router) {
      setFormData(router);
    } else {
      setFormData({
        router_name: '',
        ip_address: '',
        mac_address: '',
        api_port: 8728,
        username: '',
        password: '',
        vpn_enabled: true,
        vpn_protocol: 'wireguard',
        vpn_server: '',
        vpn_port: '',
        vpn_username: '',
        vpn_password: '',
        bandwidth_limit: '',
        notes: '',
      });
    }
  }, [router, open]);

  const createMutation = useMutation({
    mutationFn: (data) => vibelink.entities.Mikrotik.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotiks'] });
      toast.success('Router added successfully');
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error('Failed to add router: ' + error.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => vibelink.entities.Mikrotik.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotiks'] });
      toast.success('Router updated successfully');
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error('Failed to update router: ' + error.message);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.router_name || !formData.ip_address || !formData.username || !formData.password) {
      toast.error('Please fill in all required fields');
      return;
    }

    const submitData = {
      ...formData,
      api_port: parseInt(formData.api_port),
      vpn_port: formData.vpn_port ? parseInt(formData.vpn_port) : null,
      bandwidth_limit: formData.bandwidth_limit ? parseInt(formData.bandwidth_limit) : null,
    };

    if (router?.id) {
      updateMutation.mutate({ id: router.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{router ? 'Edit Router' : 'Add New Router'}</DialogTitle>
          <DialogDescription>
            {router ? 'Update router configuration' : 'Configure a new MikroTik router'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Settings */}
          <div className="space-y-4">
            <h3 className="font-semibold text-slate-900">Basic Settings</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Router Name *</Label>
                <Input
                  value={formData.router_name}
                  onChange={(e) => setFormData({ ...formData, router_name: e.target.value })}
                  placeholder="e.g., Main Branch Router"
                />
              </div>

              <div className="space-y-2">
                <Label>IP Address *</Label>
                <Input
                  value={formData.ip_address}
                  onChange={(e) => setFormData({ ...formData, ip_address: e.target.value })}
                  placeholder="e.g., 192.168.1.1"
                />
              </div>

              <div className="space-y-2">
                <Label>MAC Address</Label>
                <Input
                  value={formData.mac_address}
                  onChange={(e) => setFormData({ ...formData, mac_address: e.target.value })}
                  placeholder="00:00:00:00:00:00"
                />
              </div>

              <div className="space-y-2">
                <Label>API Port</Label>
                <Input
                  type="number"
                  value={formData.api_port}
                  onChange={(e) => setFormData({ ...formData, api_port: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>API Username *</Label>
                <Input
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder="admin"
                />
              </div>

              <div className="space-y-2">
                <Label>API Password *</Label>
                <Input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Bandwidth Limit (Mbps)</Label>
              <Input
                type="number"
                value={formData.bandwidth_limit}
                onChange={(e) => setFormData({ ...formData, bandwidth_limit: e.target.value })}
                placeholder="1000"
              />
            </div>
          </div>

          {/* VPN Settings */}
          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">VPN Settings</h3>
              <Switch
                checked={formData.vpn_enabled}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, vpn_enabled: checked })
                }
              />
            </div>

            {formData.vpn_enabled && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>VPN Protocol</Label>
                  <Select value={formData.vpn_protocol} onValueChange={(value) =>
                    setFormData({ ...formData, vpn_protocol: value })
                  }>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="wireguard">WireGuard</SelectItem>
                      <SelectItem value="pptp">PPTP</SelectItem>
                      <SelectItem value="l2tp">L2TP</SelectItem>
                      <SelectItem value="sstp">SSTP</SelectItem>
                      <SelectItem value="ipsec">IPSec</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>VPN Server</Label>
                    <Input
                      value={formData.vpn_server}
                      onChange={(e) => setFormData({ ...formData, vpn_server: e.target.value })}
                      placeholder="vpn.example.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>VPN Port</Label>
                    <Input
                      type="number"
                      value={formData.vpn_port}
                      onChange={(e) => setFormData({ ...formData, vpn_port: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>VPN Username</Label>
                    <Input
                      value={formData.vpn_username}
                      onChange={(e) => setFormData({ ...formData, vpn_username: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>VPN Password</Label>
                    <Input
                      type="password"
                      value={formData.vpn_password}
                      onChange={(e) => setFormData({ ...formData, vpn_password: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Internal notes about this router..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {router ? 'Updating...' : 'Adding...'}
                </>
              ) : router ? (
                'Update Router'
              ) : (
                'Add Router'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}