import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { Plus, Download, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import DataTable from '@/components/shared/DataTable';
import EmptyState from '@/components/shared/EmptyState';
import StatusBadge from '@/components/shared/StatusBadge';
import { Ticket, MoreVertical, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function HotspotVouchers() {
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const queryClient = useQueryClient();

  const { data: vouchers = [], isLoading } = useQuery({
    queryKey: ['vouchers'],
    queryFn: () => vibelink.entities.HotspotVoucher.list('-created_date'),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['hotspot-plans'],
    queryFn: () => vibelink.entities.HotspotPlan.list(),
  });

  const { data: hotspots = [] } = useQuery({
    queryKey: ['hotspots'],
    queryFn: () => vibelink.entities.Hotspot.list(),
  });

  const createVouchersMutation = useMutation({
    mutationFn: async (data) => {
      const vouchers = [];
      for (let i = 0; i < data.quantity; i++) {
        const code = generateVoucherCode();
        vouchers.push({
          code,
          hotspot_id: data.hotspot_id,
          hotspot_name: data.hotspot_name,
          plan_name: data.plan_name,
          duration_minutes: data.duration_minutes,
          data_limit_mb: data.data_limit_mb,
          bandwidth_limit: data.bandwidth_limit,
          price: data.price,
          status: 'unused',
          batch_id: data.batch_id,
        });
      }
      return vibelink.entities.HotspotVoucher.bulkCreate(vouchers);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['vouchers']);
      setShowForm(false);
      toast.success('Vouchers generated successfully');
    },
  });

  const deleteVoucherMutation = useMutation({
    mutationFn: (id) => vibelink.entities.HotspotVoucher.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['vouchers']);
      toast.success('Voucher deleted');
    },
  });

  const revokeVoucherMutation = useMutation({
    mutationFn: (id) => vibelink.entities.HotspotVoucher.update(id, { status: 'revoked' }),
    onSuccess: () => {
      queryClient.invalidateQueries(['vouchers']);
      toast.success('Voucher revoked');
    },
  });

  const generateVoucherCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const filteredVouchers = vouchers.filter(v => {
    const matchesSearch = v.code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         v.plan_name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || v.status === statusFilter;
    const matchesType = typeFilter === 'all' || v.plan_name === typeFilter;
    
    let matchesDateRange = true;
    if (startDate && v.created_date) {
      matchesDateRange = matchesDateRange && new Date(v.created_date) >= new Date(startDate);
    }
    if (endDate && v.created_date) {
      matchesDateRange = matchesDateRange && new Date(v.created_date) <= new Date(endDate);
    }
    
    return matchesSearch && matchesStatus && matchesType && matchesDateRange;
  });

  const exportVouchers = (vouchersToExport) => {
    const csvContent = [
      ['Code', 'Plan', 'Duration (min)', 'Price (KES)', 'Hotspot', 'Status', 'Created'],
      ...vouchersToExport.map(v => [
        v.code,
        v.plan_name,
        v.duration_minutes,
        v.price,
        v.hotspot_name || 'All',
        v.status,
        v.created_date ? format(new Date(v.created_date), 'yyyy-MM-dd HH:mm') : ''
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vouchers-${Date.now()}.csv`;
    a.click();
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setTypeFilter('all');
    setStartDate('');
    setEndDate('');
  };

  const columns = [
    {
      header: 'Code',
      cell: (row) => (
        <div>
          <span className="font-mono font-semibold text-slate-900 dark:text-slate-50 text-lg">{row.code}</span>
          {row.batch_id && <p className="text-xs text-slate-500 mt-0.5">Batch: {row.batch_id.slice(-8)}</p>}
        </div>
      )
    },
    {
      header: 'Plan',
      cell: (row) => (
        <div>
          <p className="font-medium text-slate-900 dark:text-slate-50">{row.plan_name || '-'}</p>
          <p className="text-xs text-slate-500">{row.duration_minutes} min • {row.bandwidth_limit} Mbps</p>
        </div>
      )
    },
    {
      header: 'Price',
      cell: (row) => <span className="font-medium text-slate-900 dark:text-slate-50">KES {row.price}</span>
    },
    {
      header: 'Status',
      cell: (row) => (
        <div>
          <StatusBadge status={row.status} />
          {row.activated_at && (
            <p className="text-xs text-slate-500 mt-1">
              {format(new Date(row.activated_at), 'MMM d, HH:mm')}
            </p>
          )}
        </div>
      )
    },
    {
      header: 'Hotspot',
      cell: (row) => <span className="text-slate-500">{row.hotspot_name || 'All'}</span>
    },
    {
      header: 'Used By',
      cell: (row) => <span className="font-mono text-xs text-slate-500">{row.used_by || '-'}</span>
    },
    {
      header: '',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {row.status === 'unused' && (
              <DropdownMenuItem onClick={() => revokeVoucherMutation.mutate(row.id)}>
                <X className="w-4 h-4 mr-2" />
                Revoke
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-rose-600" onClick={() => {
              if (confirm('Delete this voucher?')) deleteVoucherMutation.mutate(row.id);
            }}>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  ];

  const uniqueTypes = [...new Set(vouchers.map(v => v.plan_name).filter(Boolean))];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Vouchers</h3>
          <p className="text-sm text-slate-500">{filteredVouchers.length} of {vouchers.length} vouchers</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowForm(true)} className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4 mr-2" />
            Generate Vouchers
          </Button>
          <Button variant="outline" onClick={() => exportVouchers(filteredVouchers)}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div className="md:col-span-2">
            <Label className="text-xs mb-2 block">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search code or plan..."
                className="pl-10"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs mb-2 block">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="unused">Unused</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="revoked">Revoked</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-2 block">Voucher Type</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {uniqueTypes.map(type => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-2 block">Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs mb-2 block">End Date</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <Button variant="outline" size="sm" onClick={clearFilters}>
            <RefreshCw className="w-3 h-3 mr-2" />
            Clear Filters
          </Button>
        </div>
      </Card>

      <DataTable
        columns={columns}
        data={filteredVouchers}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            icon={Ticket}
            title="No vouchers found"
            description="Generate vouchers or adjust filters"
            actionLabel="Generate Vouchers"
            onAction={() => setShowForm(true)}
          />
        }
      />

      <VoucherFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        hotspots={hotspots}
        plans={plans}
        onSubmit={(data) => createVouchersMutation.mutate(data)}
        isLoading={createVouchersMutation.isPending}
      />
    </div>
  );
}

function VoucherFormDialog({ open, onOpenChange, hotspots, plans, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({
    hotspot_id: '', hotspot_name: '', plan_name: '', quantity: 10,
    duration_minutes: 60, data_limit_mb: 0, bandwidth_limit: 10, price: 50
  });

  const handlePlanSelect = (planId) => {
    const plan = plans.find(p => p.id === planId);
    if (plan) {
      setFormData({
        ...formData,
        plan_name: plan.name,
        duration_minutes: plan.duration_minutes,
        data_limit_mb: plan.data_limit_mb,
        bandwidth_limit: plan.bandwidth_limit,
        price: plan.price,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Vouchers</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...formData, batch_id: `BATCH-${Date.now()}` }); }} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>Select Plan (optional)</Label>
            <Select onValueChange={handlePlanSelect}>
              <SelectTrigger><SelectValue placeholder="Choose a plan or customize" /></SelectTrigger>
              <SelectContent>
                {plans.filter(p => p.is_active).map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} - {p.duration_minutes}min - KES {p.price}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Hotspot (optional)</Label>
            <Select value={formData.hotspot_id} onValueChange={(v) => {
              const h = hotspots.find(h => h.id === v);
              setFormData({...formData, hotspot_id: v, hotspot_name: h?.name || ''});
            }}>
              <SelectTrigger><SelectValue placeholder="All hotspots" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>All Hotspots</SelectItem>
                {hotspots.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Duration (min) *</Label>
              <Input type="number" value={formData.duration_minutes} onChange={(e) => setFormData({...formData, duration_minutes: Number(e.target.value)})} required />
            </div>
            <div className="space-y-2">
              <Label>Price (KES) *</Label>
              <Input type="number" step="0.01" value={formData.price} onChange={(e) => setFormData({...formData, price: Number(e.target.value)})} required />
            </div>
            <div className="space-y-2">
              <Label>Quantity *</Label>
              <Input type="number" value={formData.quantity} onChange={(e) => setFormData({...formData, quantity: Number(e.target.value)})} required />
            </div>
            <div className="space-y-2">
              <Label>Speed (Mbps) *</Label>
              <Input type="number" value={formData.bandwidth_limit} onChange={(e) => setFormData({...formData, bandwidth_limit: Number(e.target.value)})} required />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700">
              {isLoading ? 'Generating...' : `Generate ${formData.quantity} Vouchers`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}