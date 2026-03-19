import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { 
  Shield, 
  Plus, 
  Settings, 
  Cpu, 
  Activity, 
  Copy, 
  Download, 
  RefreshCw,
  Server,
  UserPlus
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter 
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';

export default function WireguardManagement() {
  const [newPeerData, setNewPeerData] = useState({
    name: '',
    inner_ip: '10.8.0.5',
    listen_port: '13231',
    device_id: ''
  });
  const queryClient = useQueryClient();

  const { data: vpnConfigs = [] } = useQuery({
    queryKey: ['vpnConfigs'],
    queryFn: () => vibelink.entities.VPNConfig.list(),
  });

  const { data: routers = [] } = useQuery({
    queryKey: ['mikrotiks'],
    queryFn: () => vibelink.entities.Mikrotik.list(),
  });

  const serverConfig = vpnConfigs.find(c => c.type === 'server');
  const peers = vpnConfigs.filter(c => c.type === 'peer');

  const generatePeerScript = (peer) => {
    if (!serverConfig) return '# Error: Server configuration missing';
    
    return `# MikroTik WireGuard Peer Config
# Peer: ${peer.name}
# Server: ${serverConfig.public_endpoint}

/interface wireguard add name=wg-vibelink listen-port=${peer.listen_port || 13231} private-key="${peer.private_key}" comment="Vibelink Management"
/interface wireguard peers add interface=wg-vibelink public-key="${serverConfig.public_key}" endpoint-address=${serverConfig.public_endpoint} endpoint-port=${serverConfig.port} allowed-address=${serverConfig.allowed_ips || '0.0.0.0/0'} persistent-keepalive=25s
/ip address add address=${peer.inner_ip}/30 interface=wg-vibelink comment="WG IP"
`;
  };

  const handleCopyScript = (peer) => {
    const script = generatePeerScript(peer);
    navigator.clipboard.writeText(script);
    toast.success('RouterOS configuration copied to clipboard');
  };

  const downloadPeerScript = (peer) => {
    const script = generatePeerScript(peer);
    const element = document.createElement('a');
    const file = new Blob([script], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `wg-peer-${peer.name.replace(/\s+/g, '_')}.rsc`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const createPeerMutation = useMutation({
    mutationFn: (data) => vibelink.entities.VPNConfig.create({
      ...data,
      type: 'peer',
      private_key: 'WG_PRIV_' + Math.random().toString(36).substr(2, 32),
      public_key: 'WG_PUB_' + Math.random().toString(36).substr(2, 32),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpnConfigs'] });
      setPeerDialogOpen(false);
      toast.success('VPN Peer created successfully');
    },
    onError: () => toast.error('Failed to create VPN peer')
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Server Status info */}
        <Card className="md:col-span-2 dark:bg-slate-900 border-indigo-100 dark:border-indigo-900/30 overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-5">
            <Server size={120} />
          </div>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <Shield className="w-5 h-5 text-indigo-500" />
                  WireGuard VPN Server
                </CardTitle>
                <CardDescription>Central VPN Gateway for remote router management</CardDescription>
              </div>
              <Badge variant={serverConfig ? "success" : "outline"} className={serverConfig ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : ""}>
                {serverConfig ? "Active" : "Not Configured"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {serverConfig ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                <div>
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Public Endpoint</p>
                  <p className="font-mono text-sm dark:text-slate-300">{serverConfig.public_endpoint}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Port</p>
                  <p className="font-mono text-sm dark:text-slate-300">{serverConfig.port}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Public Key</p>
                  <p className="font-mono text-xs truncate dark:text-slate-300 bg-slate-100 dark:bg-slate-800 p-1 rounded">{serverConfig.public_key}</p>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 border-2 border-dashed rounded-xl border-slate-200 dark:border-slate-800">
                <p className="text-slate-500 mb-4">No VPN server has been configured for this tenant.</p>
                <Button onClick={() => setServerDialogOpen(true)}>
                  <Settings className="w-4 h-4 mr-2" />
                  Configure Server
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats Card */}
        <Card className="dark:bg-slate-900">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Quick Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-500">Connected Peers</span>
              <span className="font-bold text-indigo-600">{peers.length}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-500">Available IPs</span>
              <span className="font-bold text-slate-700 dark:text-slate-300">254</span>
            </div>
            <Button variant="outline" className="w-full" onClick={() => setPeerDialogOpen(true)}>
              <UserPlus className="w-4 h-4 mr-2" />
              Add New Peer
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Peers List */}
      <Card className="dark:bg-slate-900">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>VPN Peers (Client Routers)</CardTitle>
            <CardDescription>Managed MikroTik devices connected via WireGuard</CardDescription>
          </div>
          <Button size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['vpnConfigs'] })}>
            <RefreshCw className="w-3 h-3 mr-2" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3">Router Name</th>
                  <th className="px-4 py-3">Internal IP</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last Active</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {peers.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-4 py-8 text-center text-slate-500">
                      No peers configured. Add your first client router to start secure management.
                    </td>
                  </tr>
                ) : (
                  peers.map((peer) => (
                    <tr key={peer.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 font-medium dark:text-slate-200">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-indigo-400" />
                          {peer.name}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs dark:text-slate-400">{peer.inner_ip}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Online</Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-500">Just now</td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <Button variant="ghost" size="sm" onClick={() => handleCopyScript(peer)}>
                          <Copy className="w-3.5 h-3.5 mr-1" />
                          Config
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => downloadPeerScript(peer)}>
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* New Peer Dialog */}
      <Dialog open={peerDialogOpen} onOpenChange={setPeerDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add WireGuard Peer</DialogTitle>
            <DialogDescription>Setup a new MikroTik router as a VPN client.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Select Router</Label>
              <select className="w-full p-2 rounded-md border border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <option>New Unregistered Router</option>
                {routers.map(r => (
                  <option key={r.id} value={r.id}>{r.router_name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Description / Friendly Name</Label>
              <Input 
                placeholder="Branch Office A" 
                value={newPeerData.name}
                onChange={(e) => setNewPeerData({ ...newPeerData, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Assigned Inner IP</Label>
                <Input 
                  placeholder="10.8.0.2" 
                  value={newPeerData.inner_ip}
                  onChange={(e) => setNewPeerData({ ...newPeerData, inner_ip: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Listen Port</Label>
                <Input 
                  placeholder="13231" 
                  value={newPeerData.listen_port}
                  onChange={(e) => setNewPeerData({ ...newPeerData, listen_port: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPeerDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={() => createPeerMutation.mutate(newPeerData)}
              disabled={createPeerMutation.isPending || !newPeerData.name}
            >
              {createPeerMutation.isPending ? 'Creating...' : 'Create Peer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
