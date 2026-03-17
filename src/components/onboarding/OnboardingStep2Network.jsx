import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Network } from 'lucide-react';

export default function OnboardingStep2Network({ mikrotiks = [], formData, setFormData }) {
  const { data: networks = [] } = useQuery({
    queryKey: ['networks'],
    queryFn: () => vibelink.entities.Network.list(),
  });

  // Generate available IP addresses from networks
  const availableIPs = useMemo(() => {
    const ips = [];
    networks.forEach(net => {
      if (net.network && net.total_addresses) {
        const [base] = net.network.split('/');
        const octets = base.split('.');
        const totalAddresses = parseInt(net.total_addresses);
        
        // Generate 10 sample IPs from the range (excluding network and broadcast)
        for (let i = 1; i <= Math.min(10, totalAddresses - 2); i++) {
          const lastOctet = parseInt(octets[3]) + i;
          if (lastOctet <= 255) {
            const ip = `${octets[0]}.${octets[1]}.${octets[2]}.${lastOctet}`;
            ips.push(ip);
          }
        }
      }
    });
    return ips;
  }, [networks]);
  const handleInputChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleMikrotikSelect = (mikrotikId) => {
    const mikrotik = mikrotiks.find(m => m.id === mikrotikId);
    if (mikrotik) {
      setFormData({
        ...formData,
        mikrotik_id: mikrotikId,
        mikrotik_name: mikrotik.router_name || mikrotik.name,
      });
    }
  };

  const validateIPAddress = (ip) => {
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    return ipRegex.test(ip);
  };

  const validateMAC = (mac) => {
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    return mac === '' || macRegex.test(mac);
  };

  return (
    <div className="space-y-6">
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-blue-900">
            <Network className="w-5 h-5" />
            Network Configuration
          </CardTitle>
          <CardDescription className="text-blue-800">
            Configure the customer's network settings and router assignment
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="space-y-4">
        {/* Router/MikroTik Selection */}
        <div className="space-y-2">
          <Label htmlFor="mikrotik">Assign MikroTik Router</Label>
          <Select value={formData.mikrotik_id} onValueChange={handleMikrotikSelect}>
            <SelectTrigger id="mikrotik">
              <SelectValue placeholder="Select a router..." />
            </SelectTrigger>
            <SelectContent>
              {mikrotiks.map(mikrotik => (
                <SelectItem key={mikrotik.id} value={mikrotik.id}>
                  {mikrotik.router_name || mikrotik.name} ({mikrotik.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500">
            Choose which MikroTik router will manage this customer's connection
          </p>
        </div>

        {/* IP Address */}
         <div className="space-y-2">
           <Label htmlFor="ip">IP Address *</Label>
           {availableIPs.length > 0 ? (
             <Select value={formData.ip_address} onValueChange={(value) => handleInputChange('ip_address', value)}>
               <SelectTrigger id="ip">
                 <SelectValue placeholder="Select an available IP address..." />
               </SelectTrigger>
               <SelectContent>
                 {availableIPs.map((ip) => (
                   <SelectItem key={ip} value={ip}>
                     {ip}
                   </SelectItem>
                 ))}
               </SelectContent>
             </Select>
           ) : (
             <Input
               id="ip"
               placeholder="e.g., 192.168.1.100"
               value={formData.ip_address}
               onChange={(e) => handleInputChange('ip_address', e.target.value)}
               className={
                 formData.ip_address && !validateIPAddress(formData.ip_address)
                   ? 'border-rose-500'
                   : ''
               }
             />
           )}
           {formData.ip_address && !validateIPAddress(formData.ip_address) && (
             <p className="text-xs text-rose-600 flex items-center gap-1">
               <AlertCircle className="w-3 h-3" />
               Invalid IP address format
             </p>
           )}
           <p className="text-xs text-slate-500">
             {availableIPs.length > 0 
               ? 'Select from available IP addresses in your network pools'
               : 'The IP address assigned to this customer\'s CPE (Customer Premises Equipment)'}
           </p>
         </div>

        {/* MAC Address */}
        <div className="space-y-2">
          <Label htmlFor="mac">MAC Address</Label>
          <Input
            id="mac"
            placeholder="e.g., 00:1A:2B:3C:4D:5E"
            value={formData.mac_address}
            onChange={(e) => handleInputChange('mac_address', e.target.value)}
            className={
              formData.mac_address && !validateMAC(formData.mac_address)
                ? 'border-rose-500'
                : ''
            }
          />
          {formData.mac_address && !validateMAC(formData.mac_address) && (
            <p className="text-xs text-rose-600 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Invalid MAC address format
            </p>
          )}
          <p className="text-xs text-slate-500">
            MAC address of the customer's device (optional, can be auto-detected)
          </p>
        </div>
      </div>

      {/* Validation Status */}
      <Card className="bg-slate-50 border-slate-200">
        <CardContent className="pt-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className={`text-2xl ${formData.mikrotik_id ? '✓ text-emerald-600' : 'text-slate-400'}`}>
                {formData.mikrotik_id ? '✓' : '○'}
              </div>
              <p className="text-xs text-slate-600 mt-1">Router</p>
            </div>
            <div className="text-center">
              <div className={`text-2xl ${formData.ip_address && validateIPAddress(formData.ip_address) ? '✓ text-emerald-600' : 'text-slate-400'}`}>
                {formData.ip_address && validateIPAddress(formData.ip_address) ? '✓' : '○'}
              </div>
              <p className="text-xs text-slate-600 mt-1">IP Address</p>
            </div>
            <div className="text-center">
              <div className={`text-2xl ${!formData.mac_address || validateMAC(formData.mac_address) ? '✓ text-emerald-600' : 'text-slate-400'}`}>
                {!formData.mac_address || validateMAC(formData.mac_address) ? '✓' : '○'}
              </div>
              <p className="text-xs text-slate-600 mt-1">MAC Address</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}