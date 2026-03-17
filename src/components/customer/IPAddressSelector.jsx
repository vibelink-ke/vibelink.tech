import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Wifi } from 'lucide-react';

/**
 * Shows a dropdown of available IPs from a configured pool.
 * Falls back to free-text input if no pool is configured.
 */
export default function IPAddressSelector({ value, onChange, excludeIds = [] }) {
  const [manualInput, setManualInput] = useState(false);

  // Fetch all customers to know which IPs are taken
  const { data: customers = [] } = useQuery({
    queryKey: ['customers-ips'],
    queryFn: () => vibelink.entities.Customer.list(),
  });

  // Fetch IP pool settings
  const { data: settings = [] } = useQuery({
    queryKey: ['settings'],
    queryFn: () => vibelink.entities.Setting.list(),
  });

  const ipPoolSetting = settings.find(s => s.key === 'ip_address_pool');
  const ipPool = useMemo(() => {
    if (!ipPoolSetting) return [];
    try {
      return JSON.parse(ipPoolSetting.value);
    } catch {
      // If it's a CIDR like "192.168.1.0/24", expand it
      return expandCIDR(ipPoolSetting.value);
    }
  }, [ipPoolSetting]);

  // IPs used by other customers
  const usedIPs = new Set(
    customers
      .filter(c => !excludeIds.includes(c.id) && c.ip_address)
      .map(c => c.ip_address)
  );

  const availableIPs = ipPool.filter(ip => !usedIPs.has(ip));

  if (!ipPool.length || manualInput) {
    return (
      <div className="space-y-1">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="192.168.1.x"
        />
        {ipPool.length > 0 && (
          <button
            type="button"
            className="text-xs text-indigo-600 underline"
            onClick={() => setManualInput(false)}
          >
            Choose from pool
          </button>
        )}
        {!ipPool.length && (
          <p className="text-xs text-slate-400">No IP pool configured. Go to Settings → General to add one.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select IP address" />
        </SelectTrigger>
        <SelectContent>
          {value && usedIPs.has(value) && (
            <SelectItem value={value}>
              {value} <span className="text-xs text-amber-600 ml-1">(current)</span>
            </SelectItem>
          )}
          {availableIPs.length === 0 && (
            <SelectItem value={null} disabled>No available IPs in pool</SelectItem>
          )}
          {availableIPs.map(ip => (
            <SelectItem key={ip} value={ip}>
              <div className="flex items-center gap-2">
                <Wifi className="w-3 h-3 text-emerald-500" />
                {ip}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          {availableIPs.length} available of {ipPool.length} total
        </p>
        <button
          type="button"
          className="text-xs text-indigo-600 underline"
          onClick={() => setManualInput(true)}
        >
          Enter manually
        </button>
      </div>
    </div>
  );
}

// Expand a simple /24 CIDR to list of IPs (handles common cases)
function expandCIDR(cidr) {
  try {
    const [base, prefix] = cidr.trim().split('/');
    if (!prefix) return [];
    const prefixLen = parseInt(prefix);
    const parts = base.split('.').map(Number);
    if (parts.length !== 4 || prefixLen < 16 || prefixLen > 30) return [];

    const ips = [];
    const hostBits = 32 - prefixLen;
    const count = Math.pow(2, hostBits);
    const baseNum = (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
    const networkNum = baseNum & (~(count - 1));

    for (let i = 1; i < count - 1; i++) {
      const n = networkNum + i;
      ips.push([
        (n >>> 24) & 0xff,
        (n >>> 16) & 0xff,
        (n >>> 8) & 0xff,
        n & 0xff,
      ].join('.'));
    }
    return ips;
  } catch {
    return [];
  }
}