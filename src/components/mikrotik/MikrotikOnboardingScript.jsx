import React, { useState, useEffect } from 'react';
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
import { Copy, Download, Terminal, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { vibelink } from '@/api/vibelinkClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export default function MikrotikOnboardingScript({ open, onOpenChange, router }) {
  const [formData, setFormData] = useState({
    router_name: '',
    ip_address: '',
    api_username: 'vibelink-api',
    api_password: Math.random().toString(36).slice(-10),
    bandwidth_limit: '1000',
    vpn_enabled: true,
    vpn_protocol: 'wireguard'
  });

  const [generatedScript, setGeneratedScript] = useState('');
  const [step, setStep] = useState(1); // 1: Config, 2: Script
  const [saveStatus, setSaveStatus] = useState('idle'); // idle, success, error
  const queryClient = useQueryClient();

  useEffect(() => {
    if (router) {
      setFormData({
        router_name: router.router_name || '',
        ip_address: router.ip_address || '',
        api_username: router.username || 'vibelink-api',
        api_password: router.password || Math.random().toString(36).slice(-10),
        bandwidth_limit: router.bandwidth_limit?.toString() || '1000',
        vpn_enabled: router.vpn_enabled ?? true,
        vpn_protocol: router.vpn_protocol || 'wireguard'
      });
      setStep(1);
      setSaveStatus('idle');
    }
  }, [router, open]);

  const generateScript = (data) => {
    const date = new Date().toISOString().split('T')[0];
    const appUrl = window.location.origin;
    const routerId = data.id || 'PENDING_REGISTRATION';

    return `# VIBELINK - Auto-Onboarding Script
# Router: ${data.router_name}
# Generated: ${date}

# 1. Create API user
/user add name="${data.api_username}" password="${data.api_password}" group=full comment="Vibelink Management API"

# 2. Configure IP and basic networking
/ip address add address=${data.ip_address}/24 interface=ether1 comment="WAN IP"
/ip firewall nat add chain=srcnat action=masquerade out-interface=ether1 comment="Default NAT"

# 3. Bandwidth Management
/queue simple add name="${data.router_name}-bw" max-limit=${data.bandwidth_limit}M/${data.bandwidth_limit}M target=0.0.0.0/0

# 4. VPN Client Setup
${data.vpn_enabled ? `
/interface ${data.vpn_protocol} add name=wg-vibelink comment="Vibelink Management Tunnel"
# Additional VPN configuration should be added here
` : '# VPN disabled'}

# 5. Heartbeat / Auto-registration
/system scheduler add name=vibelink-heartbeat interval=5m \\
  on-event="/tool fetch url=\\"${appUrl}/api/heartbeat?router=${routerId}\\" keep-result=no"
`;
  };

  const createMutation = useMutation({
    mutationFn: (data) => vibelink.entities.Mikrotik.create({
      router_name: data.router_name,
      ip_address: data.ip_address,
      username: data.api_username,
      password: data.api_password,
      bandwidth_limit: parseInt(data.bandwidth_limit),
      vpn_enabled: data.vpn_enabled,
      vpn_protocol: data.vpn_protocol,
      status: 'pending'
    }),
    onSuccess: (newRouter) => {
      queryClient.invalidateQueries({ queryKey: ['mikrotiks'] });
      setGeneratedScript(generateScript({ ...formData, id: newRouter.id }));
      setSaveStatus('success');
      toast.success('Router record saved to dashboard');
    },
    onError: () => {
      setSaveStatus('error');
      // Still allow the script to be used even if save fails
      toast.error('Could not save router to dashboard, but you can still use the script.');
    }
  });

  const handleGenerate = () => {
    if (!formData.router_name || !formData.ip_address) {
      toast.error('Router Name and IP Address are required');
      return;
    }

    // Always generate and show script first to be responsive
    setGeneratedScript(generateScript(formData));
    setStep(2);
    
    // Attempt background save if it's a new router
    if (!router?.id) {
      setSaveStatus('idle');
      createMutation.mutate(formData);
    } else {
      setSaveStatus('success'); // Already exists
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedScript);
    toast.success('Script copied to clipboard');
  };

  const downloadScript = () => {
    const element = document.createElement('a');
    const file = new Blob([generatedScript], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `onboard-${formData.router_name.replace(/\s+/g, '_')}.rsc`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="">
          <DialogTitle className="">MikroTik Auto-Onboarding Script</DialogTitle>
          <DialogDescription className="">
            Generate a RouterOS script to automatically configure your device.
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-6 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="">Router Name *</Label>
                <Input
                  value={formData.router_name}
                  onChange={(e) => setFormData({ ...formData, router_name: e.target.value })}
                  placeholder="Main Branch"
                />
              </div>
              <div className="space-y-2">
                <Label className="">Expected IP Address *</Label>
                <Input
                  value={formData.ip_address}
                  onChange={(e) => setFormData({ ...formData, ip_address: e.target.value })}
                  placeholder="192.168.1.1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="">API Username</Label>
                <Input
                  value={formData.api_username}
                  onChange={(e) => setFormData({ ...formData, api_username: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="">API Password (Auto-generated)</Label>
                <Input
                  type="password"
                  value={formData.api_password}
                  onChange={(e) => setFormData({ ...formData, api_password: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="">Bandwidth Limit (Mbps)</Label>
                <Input
                  type="number"
                  value={formData.bandwidth_limit}
                  onChange={(e) => setFormData({ ...formData, bandwidth_limit: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="">VPN Protocol</Label>
                <Select
                  value={formData.vpn_protocol}
                  onValueChange={(v) => setFormData({ ...formData, vpn_protocol: v })}
                >
                  <SelectTrigger className="">
                    <SelectValue className="" />
                  </SelectTrigger>
                  <SelectContent className="">
                    <SelectItem value="wireguard">WireGuard</SelectItem>
                    <SelectItem value="pptp">PPTP</SelectItem>
                    <SelectItem value="l2tp">L2TP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleGenerate} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Processing...' : 'Generate Script'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {saveStatus === 'error' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                <span>Note: Failed to save router to dashboard (API Error), but the script below is still valid.</span>
              </div>
            )}

            <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm text-slate-100 overflow-x-auto relative group">
              <pre className="whitespace-pre-wrap">{generatedScript}</pre>
              <Button 
                onClick={copyToClipboard} 
                size="sm" 
                variant="secondary" 
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Copy className="w-4 h-4 mr-2" /> Copy
              </Button>
            </div>
            
            <div className="flex gap-2">
              <Button onClick={copyToClipboard} variant="secondary" className="flex-1">
                <Copy className="w-4 h-4 mr-2" /> Copy Script
              </Button>
              <Button onClick={downloadScript} variant="secondary" className="flex-1">
                <Download className="w-4 h-4 mr-2" /> Download .rsc
              </Button>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 flex gap-3">
              <div className="shrink-0 pt-1"><Terminal className="w-4 h-4" /></div>
              <div>
                <p className="font-semibold">How to apply:</p>
                <ol className="list-decimal list-inside space-y-1 mt-1">
                  <li>Open MikroTik WinBox or WebFig</li>
                  <li>Go to <strong>System</strong> -&gt; <strong>Scripts</strong> or open <strong>New Terminal</strong></li>
                  <li>Paste the script content above into the terminal and press Enter</li>
                  <li>The router will configure itself and connect back to this app</li>
                </ol>
              </div>
            </div>

            <DialogFooter className="">
              <Button variant="outline" onClick={() => setStep(1)}>Go Back</Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
