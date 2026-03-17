import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Edit2, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/shared/PageHeader';

export default function IPAddressPool() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editingNetwork, setEditingNetwork] = useState(null);
  const [formData, setFormData] = useState({
    network: '',
    title: '',
    comment: '',
    subnet: '',
    nas: '',
    total_addresses: '',
    clients_host_range: '',
    netmask: '',
  });

  const { data: networks = [] } = useQuery({
    queryKey: ['networks'],
    queryFn: () => vibelink.entities.Network.list(),
  });

  const { data: nasList = [] } = useQuery({
    queryKey: ['nas-list'],
    queryFn: () => vibelink.entities.Mikrotik?.list?.() || Promise.resolve([]),
  });

  const createNetworkMutation = useMutation({
    mutationFn: (data) => vibelink.entities.Network.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['networks'] });
      toast.success('Network created successfully');
      resetForm();
    },
  });

  const updateNetworkMutation = useMutation({
    mutationFn: ({ id, data }) => vibelink.entities.Network.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['networks'] });
      toast.success('Network updated successfully');
      resetForm();
    },
  });

  const deleteNetworkMutation = useMutation({
    mutationFn: (id) => vibelink.entities.Network.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['networks'] });
      toast.success('Network deleted successfully');
    },
  });

  const calculateNetworkDetails = (subnetValue) => {
    if (!subnetValue) return { netmask: '', total_addresses: '', clients_host_range: '' };

    const subnetNum = parseInt(subnetValue);
    const subnetMasks = {
      24: '255.255.255.0',
      25: '255.255.255.128',
      26: '255.255.255.192',
      27: '255.255.255.224',
      28: '255.255.255.240',
      29: '255.255.255.248',
      30: '255.255.255.252',
      23: '255.255.254.0',
      22: '255.255.252.0',
      21: '255.255.248.0',
      20: '255.255.240.0',
      19: '255.255.224.0',
      18: '255.255.192.0',
      17: '255.255.128.0',
      16: '255.255.0.0',
    };

    const totalAddresses = Math.pow(2, 32 - subnetNum);
    const usableHosts = totalAddresses - 2;
    const netmask = subnetMasks[subnetNum] || '';
    const clientsRange = `[${totalAddresses - usableHosts + 1} - ${totalAddresses - 1}]`;

    return {
      netmask,
      total_addresses: totalAddresses.toString(),
      clients_host_range: clientsRange,
    };
  };

  const resetForm = () => {
    setFormData({
      network: '',
      title: '',
      comment: '',
      subnet: '',
      nas: '',
      total_addresses: '',
      clients_host_range: '',
      netmask: '',
    });
    setEditingNetwork(null);
    setShowDialog(false);
  };

  const handleOpenDialog = (network = null) => {
    if (network) {
      setEditingNetwork(network);
      setFormData({
        network: network.network || '',
        title: network.title || '',
        comment: network.comment || '',
        subnet: network.subnet || '',
        nas: network.nas || '',
        total_addresses: network.total_addresses?.toString() || '',
        clients_host_range: network.clients_host_range || '',
        netmask: network.netmask || '',
      });
    } else {
      resetForm();
    }
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!formData.network || !formData.title || !formData.subnet) {
      toast.error('Please fill in required fields');
      return;
    }

    const data = {
      ...formData,
      total_addresses: formData.total_addresses ? parseInt(formData.total_addresses) : 0,
    };

    if (editingNetwork) {
      updateNetworkMutation.mutate({ id: editingNetwork.id, data });
    } else {
      createNetworkMutation.mutate(data);
    }
  };

  const filteredNetworks = networks.filter(
    (net) =>
      net.network?.toLowerCase().includes(search.toLowerCase()) ||
      net.title?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="IP Address Pool"
        description="Manage network segments and IP address allocations"
      />

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search networks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Button onClick={() => handleOpenDialog()} className="bg-indigo-600 hover:bg-indigo-700">
          <Plus className="w-4 h-4 mr-2" /> Create Network
        </Button>
      </div>

      {/* Networks Table */}
      <Card>
        <CardHeader>
          <CardTitle>IPv4 Networks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">ID</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Network</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Subnet</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Title</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Comment</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">NAS</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Total Addresses</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Clients Range</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Netmask</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredNetworks.map((network) => (
                  <tr key={network.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4 text-sm text-slate-600">{network.id}</td>
                    <td className="py-3 px-4 text-sm font-medium text-slate-900">{network.network}</td>
                    <td className="py-3 px-4 text-sm text-slate-600">{network.subnet}</td>
                    <td className="py-3 px-4 text-sm text-slate-600">{network.title}</td>
                    <td className="py-3 px-4 text-sm text-slate-500">{network.comment || '-'}</td>
                    <td className="py-3 px-4 text-sm text-slate-600">{network.nas || '-'}</td>
                    <td className="py-3 px-4 text-sm text-slate-600">{network.total_addresses || '-'}</td>
                    <td className="py-3 px-4 text-sm font-mono text-slate-600">{network.clients_host_range || '-'}</td>
                    <td className="py-3 px-4 text-sm font-mono text-slate-600">{network.netmask || '-'}</td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex justify-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenDialog(network)}
                        >
                          <Edit2 className="w-4 h-4 text-amber-600" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (window.confirm('Delete this network?')) {
                              deleteNetworkMutation.mutate(network.id);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-rose-600" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredNetworks.length === 0 && (
              <div className="text-center py-12">
                <p className="text-slate-500">No networks found</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingNetwork ? 'Edit Network' : 'Create Network'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Network Address *</Label>
              <Input
                placeholder="e.g., 192.168.0.0"
                value={formData.network}
                onChange={(e) => setFormData({ ...formData, network: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Title *</Label>
              <Input
                placeholder="e.g., Main Network"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Comment</Label>
              <Textarea
                placeholder="Optional notes about this network"
                value={formData.comment}
                onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                className="h-20"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Subnet *</Label>
                <Input
                  placeholder="e.g., /24"
                  value={formData.subnet}
                  onChange={(e) => {
                    const subnet = e.target.value;
                    setFormData({ ...formData, subnet });
                    if (subnet) {
                      const calculated = calculateNetworkDetails(subnet);
                      setFormData(prev => ({ ...prev, subnet, ...calculated }));
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Netmask</Label>
                <Input
                  placeholder="e.g., 255.255.255.0"
                  value={formData.netmask}
                  readOnly
                  className="bg-slate-50"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>NAS Device</Label>
              <Select value={formData.nas} onValueChange={(v) => setFormData({ ...formData, nas: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select NAS device" />
                </SelectTrigger>
                <SelectContent>
                  {nasList.map((nas) => (
                    <SelectItem key={nas.id} value={nas.id}>
                      {nas.router_name || nas.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Total Addresses</Label>
                <Input
                  type="number"
                  placeholder="e.g., 256"
                  value={formData.total_addresses}
                  readOnly
                  className="bg-slate-50"
                />
              </div>
              <div className="space-y-2">
                <Label>Clients Host Range</Label>
                <Input
                  placeholder="e.g., [10.100.0.1 - 10.100.255.254]"
                  value={formData.clients_host_range}
                  readOnly
                  className="bg-slate-50"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setShowDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={createNetworkMutation.isPending || updateNetworkMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {editingNetwork ? 'Update Network' : 'Create Network'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}