import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { 
  Shield, 
  Plus, 
  Edit2, 
  Trash2,
  Clock,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  Award,
  Users,
  XCircle,
  Download,
  Calendar
} from 'lucide-react';
import { differenceInHours } from 'date-fns';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

const COLORS = ['#10b981', '#f59e0b', '#ef4444'];

export default function SLA() {
  const [showForm, setShowForm] = useState(false);
  const [editingSLA, setEditingSLA] = useState(null);
  const [period, setPeriod] = useState('current');
  const queryClient = useQueryClient();

  const { data: slas = [], isLoading: loadingSLAs } = useQuery({
    queryKey: ['slas'],
    queryFn: () => vibelink.entities.SLA.list(),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => vibelink.entities.Customer.list(),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['plans'],
    queryFn: () => vibelink.entities.ServicePlan.list(),
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => vibelink.entities.SupportTicket.list(),
  });

  const { data: outages = [] } = useQuery({
    queryKey: ['outages'],
    queryFn: () => vibelink.entities.Outage.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => vibelink.entities.SLA.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['slas']);
      setShowForm(false);
      setEditingSLA(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => vibelink.entities.SLA.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['slas']);
      setShowForm(false);
      setEditingSLA(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => vibelink.entities.SLA.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['slas']),
  });

  const plansWithSLA = (slaId) => plans.filter(p => p.sla_id === slaId).length;

  // Calculate SLA compliance metrics
  const complianceData = React.useMemo(() => {
    const activeCustomers = customers.filter(c => c.status === 'active');
    const customersWithSLA = activeCustomers.filter(c => {
      const plan = plans.find(p => p.id === c.plan_id);
      return plan?.sla_id;
    });

    const metrics = customersWithSLA.map(customer => {
      const plan = plans.find(p => p.id === customer.plan_id);
      const sla = slas.find(s => s.id === plan?.sla_id);
      if (!sla) return null;

      const customerTickets = tickets.filter(t => t.customer_id === customer.id);
      
      const ticketsWithResponse = customerTickets.filter(t => t.created_date);
      const avgResponseTime = ticketsWithResponse.length > 0
        ? ticketsWithResponse.reduce((sum, t) => sum + 2, 0) / ticketsWithResponse.length
        : 0;

      const responseCompliant = !sla.ticket_response_time_hours || avgResponseTime <= sla.ticket_response_time_hours;

      const resolvedTickets = customerTickets.filter(t => t.resolved_date && t.created_date);
      const avgResolutionTime = resolvedTickets.length > 0
        ? resolvedTickets.reduce((sum, t) => {
            const hours = differenceInHours(new Date(t.resolved_date), new Date(t.created_date));
            return sum + hours;
          }, 0) / resolvedTickets.length
        : 0;

      const resolutionCompliant = !sla.ticket_resolution_time_hours || avgResolutionTime <= sla.ticket_resolution_time_hours;

      const customerOutages = outages.filter(o => 
        o.status === 'resolved' && 
        o.actual_resolution && 
        o.created_date
      );
      const totalDowntime = customerOutages.reduce((sum, o) => {
        const hours = differenceInHours(new Date(o.actual_resolution), new Date(o.created_date));
        return sum + hours;
      }, 0);
      
      const hoursInPeriod = 720;
      const actualUptime = totalDowntime > 0 ? ((hoursInPeriod - totalDowntime) / hoursInPeriod) * 100 : 100;
      const uptimeCompliant = actualUptime >= sla.uptime_percentage;

      const overallCompliant = responseCompliant && resolutionCompliant && uptimeCompliant;

      return {
        customer,
        sla,
        plan,
        metrics: {
          avgResponseTime: avgResponseTime.toFixed(1),
          avgResolutionTime: avgResolutionTime.toFixed(1),
          actualUptime: actualUptime.toFixed(2),
          ticketsCount: customerTickets.length,
          resolvedCount: resolvedTickets.length,
        },
        compliance: {
          response: responseCompliant,
          resolution: resolutionCompliant,
          uptime: uptimeCompliant,
          overall: overallCompliant,
        }
      };
    }).filter(Boolean);

    const compliantCount = metrics.filter(m => m.compliance.overall).length;
    const warningCount = metrics.filter(m => 
      !m.compliance.overall && 
      (m.metrics.actualUptime >= m.sla.uptime_percentage - 0.5 || 
       m.metrics.avgResponseTime <= (m.sla.ticket_response_time_hours || 0) * 1.2)
    ).length;
    const breachedCount = metrics.length - compliantCount - warningCount;

    const statusDistribution = [
      { name: 'Compliant', value: compliantCount, color: '#10b981' },
      { name: 'Warning', value: warningCount, color: '#f59e0b' },
      { name: 'Breached', value: breachedCount, color: '#ef4444' },
    ].filter(s => s.value > 0);

    const byPolicy = {};
    metrics.forEach(m => {
      if (!byPolicy[m.sla.id]) {
        byPolicy[m.sla.id] = {
          name: m.sla.name,
          total: 0,
          compliant: 0,
          breached: 0,
        };
      }
      byPolicy[m.sla.id].total++;
      if (m.compliance.overall) {
        byPolicy[m.sla.id].compliant++;
      } else {
        byPolicy[m.sla.id].breached++;
      }
    });

    const policyData = Object.values(byPolicy);

    return { metrics, compliantCount, warningCount, breachedCount, statusDistribution, policyData, customersWithSLA };
  }, [customers, slas, plans, tickets, outages]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="SLA Management"
          subtitle="Manage policies and track compliance"
          actionLabel="Create SLA"
          actionIcon={Plus}
          onAction={() => { setEditingSLA(null); setShowForm(true); }}
        />

        <Tabs defaultValue="policies" className="space-y-6">
          <TabsList className="bg-white dark:bg-slate-800 border dark:border-slate-700 p-1">
            <TabsTrigger value="policies" className="gap-2">
              <Shield className="w-4 h-4" /> Policies
            </TabsTrigger>
            <TabsTrigger value="compliance" className="gap-2">
              <CheckCircle className="w-4 h-4" /> Compliance
            </TabsTrigger>
          </TabsList>

          {/* POLICIES TAB */}
          <TabsContent value="policies" className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <Shield className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{slas.length}</p>
                      <p className="text-xs text-slate-500">SLA Policies</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{slas.filter(s => s.status === 'active').length}</p>
                      <p className="text-xs text-slate-500">Active</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                      <Award className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">
                        {slas.reduce((max, s) => Math.max(max, s.uptime_percentage || 0), 0)}%
                      </p>
                      <p className="text-xs text-slate-500">Best Uptime SLA</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{plans.filter(p => p.sla_id).length}</p>
                      <p className="text-xs text-slate-500">Plans with SLA</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {loadingSLAs ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[1, 2].map(i => <div key={i} className="h-64 bg-white rounded-2xl animate-pulse" />)}
              </div>
            ) : slas.length === 0 ? (
              <EmptyState
                icon={Shield}
                title="No SLA policies defined"
                description="Create SLA policies to set service guarantees"
                actionLabel="Create SLA"
                onAction={() => setShowForm(true)}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {slas.map((sla, index) => (
                  <motion.div
                    key={sla.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <Card className="hover:shadow-lg transition-shadow">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-indigo-50">
                              <Shield className="w-5 h-5 text-indigo-600" />
                            </div>
                            <div>
                              <CardTitle className="text-lg">{sla.name}</CardTitle>
                              <div className="flex gap-2 mt-1">
                                <Badge variant={sla.status === 'active' ? 'default' : 'secondary'}>
                                  {sla.status}
                                </Badge>
                                <Badge variant="outline">{plansWithSLA(sla.id)} plans</Badge>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" onClick={() => { setEditingSLA(sla); setShowForm(true); }}>
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              className="text-rose-500" 
                              onClick={() => {
                                if (confirm('Delete this SLA policy?')) {
                                  deleteMutation.mutate(sla.id);
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {sla.description && (
                          <p className="text-sm text-slate-600 mb-4">{sla.description}</p>
                        )}
                        
                        <div className="space-y-3">
                          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                            <div className="flex items-center gap-2">
                              <TrendingUp className="w-4 h-4 text-emerald-500" />
                              <span className="text-sm text-slate-700">Uptime Guarantee</span>
                            </div>
                            <span className="font-semibold text-emerald-600">{sla.uptime_percentage}%</span>
                          </div>

                          {sla.ticket_response_time_hours && (
                            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                              <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-blue-500" />
                                <span className="text-sm text-slate-700">Response Time</span>
                              </div>
                              <span className="font-semibold text-slate-900">{sla.ticket_response_time_hours}h</span>
                            </div>
                          )}

                          {sla.ticket_resolution_time_hours && (
                            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                              <div className="flex items-center gap-2">
                                <CheckCircle className="w-4 h-4 text-purple-500" />
                                <span className="text-sm text-slate-700">Resolution Time</span>
                              </div>
                              <span className="font-semibold text-slate-900">{sla.ticket_resolution_time_hours}h</span>
                            </div>
                          )}

                          {sla.penalty_percentage && (
                            <div className="flex items-center justify-between p-3 bg-rose-50 rounded-lg">
                              <div className="flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-rose-500" />
                                <span className="text-sm text-rose-700">Service Credit</span>
                              </div>
                              <span className="font-semibold text-rose-600">{sla.penalty_percentage}%</span>
                            </div>
                          )}

                          <div className="flex flex-wrap gap-2 pt-2">
                            {sla.priority_support && (
                              <Badge variant="outline" className="text-xs">
                                <Award className="w-3 h-3 mr-1" />
                                Priority Support
                              </Badge>
                            )}
                            {sla.dedicated_support && (
                              <Badge variant="outline" className="text-xs">
                                <Shield className="w-3 h-3 mr-1" />
                                Dedicated Support
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* COMPLIANCE TAB */}
          <TabsContent value="compliance" className="space-y-6">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger className="w-40 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                    <Calendar className="w-4 h-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current">Current Month</SelectItem>
                    <SelectItem value="last">Last Month</SelectItem>
                    <SelectItem value="quarter">Last Quarter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <Users className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{complianceData.customersWithSLA.length}</p>
                      <p className="text-xs text-slate-500">Under SLA</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-emerald-600">{complianceData.compliantCount}</p>
                      <p className="text-xs text-slate-500">Compliant</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-amber-600">{complianceData.warningCount}</p>
                      <p className="text-xs text-slate-500">Warnings</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-rose-50 flex items-center justify-center">
                      <XCircle className="w-5 h-5 text-rose-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-rose-600">{complianceData.breachedCount}</p>
                      <p className="text-xs text-slate-500">Breaches</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Compliance by SLA Policy</CardTitle>
                  <CardDescription>Performance across different SLA tiers</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={complianceData.policyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" stroke="#94a3b8" />
                        <YAxis stroke="#94a3b8" />
                        <ChartTooltip contentStyle={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px' }} />
                        <Legend />
                        <Bar dataKey="compliant" name="Compliant" fill="#10b981" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="breached" name="Breached" fill="#ef4444" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Overall Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={complianceData.statusDistribution}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={70}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {complianceData.statusDistribution.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <ChartTooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Customer SLA Performance</CardTitle>
                  <Button variant="outline" size="sm">
                    <Download className="w-4 h-4 mr-2" />
                    Export Report
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>SLA Policy</TableHead>
                      <TableHead>Uptime</TableHead>
                      <TableHead>Avg Response</TableHead>
                      <TableHead>Avg Resolution</TableHead>
                      <TableHead>Tickets</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {complianceData.metrics.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                          No customers with SLA policies
                        </TableCell>
                      </TableRow>
                    ) : (
                      complianceData.metrics.map((item) => (
                        <TableRow key={item.customer.id} className="hover:bg-slate-50">
                          <TableCell>
                            <div>
                              <p className="font-medium text-slate-900">{item.customer.full_name}</p>
                              <p className="text-xs text-slate-500">{item.customer.customer_id}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{item.sla.name}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className={`font-semibold ${
                                item.compliance.uptime ? 'text-emerald-600' : 'text-rose-600'
                              }`}>
                                {item.metrics.actualUptime}%
                              </span>
                              {!item.compliance.uptime && (
                                <AlertTriangle className="w-4 h-4 text-rose-500" />
                              )}
                            </div>
                            <p className="text-xs text-slate-500">Target: {item.sla.uptime_percentage}%</p>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className={`font-semibold ${
                                item.compliance.response ? 'text-emerald-600' : 'text-rose-600'
                              }`}>
                                {item.metrics.avgResponseTime}h
                              </span>
                              {!item.compliance.response && (
                                <AlertTriangle className="w-4 h-4 text-rose-500" />
                              )}
                            </div>
                            <p className="text-xs text-slate-500">
                              Target: {item.sla.ticket_response_time_hours || 'N/A'}h
                            </p>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className={`font-semibold ${
                                item.compliance.resolution ? 'text-emerald-600' : 'text-rose-600'
                              }`}>
                                {item.metrics.avgResolutionTime}h
                              </span>
                              {!item.compliance.resolution && (
                                <AlertTriangle className="w-4 h-4 text-rose-500" />
                              )}
                            </div>
                            <p className="text-xs text-slate-500">
                              Target: {item.sla.ticket_resolution_time_hours || 'N/A'}h
                            </p>
                          </TableCell>
                          <TableCell>
                            <p className="font-medium">{item.metrics.ticketsCount}</p>
                            <p className="text-xs text-slate-500">{item.metrics.resolvedCount} resolved</p>
                          </TableCell>
                          <TableCell>
                            {item.compliance.overall ? (
                              <Badge className="bg-emerald-100 text-emerald-700">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Compliant
                              </Badge>
                            ) : (
                              <Badge className="bg-rose-100 text-rose-700">
                                <XCircle className="w-3 h-3 mr-1" />
                                Breach
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <SLAFormDialog
          open={showForm}
          onOpenChange={setShowForm}
          sla={editingSLA}
          onSubmit={(data) => {
            if (editingSLA) {
              updateMutation.mutate({ id: editingSLA.id, data });
            } else {
              createMutation.mutate(data);
            }
          }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      </div>
    </div>
  );
}

function SLAFormDialog({ open, onOpenChange, sla, onSubmit, isLoading }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    uptime_percentage: 99.9,
    ticket_response_time_hours: 4,
    ticket_resolution_time_hours: 24,
    critical_issue_response_hours: 1,
    outage_notification_minutes: 30,
    priority_support: false,
    dedicated_support: false,
    penalty_percentage: 5,
    status: 'active',
  });

  React.useEffect(() => {
    if (sla) {
      setFormData({
        name: sla.name || '',
        description: sla.description || '',
        uptime_percentage: sla.uptime_percentage || 99.9,
        ticket_response_time_hours: sla.ticket_response_time_hours || 4,
        ticket_resolution_time_hours: sla.ticket_resolution_time_hours || 24,
        critical_issue_response_hours: sla.critical_issue_response_hours || 1,
        outage_notification_minutes: sla.outage_notification_minutes || 30,
        priority_support: sla.priority_support || false,
        dedicated_support: sla.dedicated_support || false,
        penalty_percentage: sla.penalty_percentage || 5,
        status: sla.status || 'active',
      });
    } else {
      setFormData({
        name: '',
        description: '',
        uptime_percentage: 99.9,
        ticket_response_time_hours: 4,
        ticket_resolution_time_hours: 24,
        critical_issue_response_hours: 1,
        outage_notification_minutes: 30,
        priority_support: false,
        dedicated_support: false,
        penalty_percentage: 5,
        status: 'active',
      });
    }
  }, [sla, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{sla ? 'Edit SLA Policy' : 'Create SLA Policy'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(formData); }} className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <Label>Policy Name *</Label>
              <Input 
                value={formData.name} 
                onChange={(e) => setFormData({...formData, name: e.target.value})} 
                placeholder="e.g., Premium SLA"
                required 
              />
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Description</Label>
              <Textarea 
                value={formData.description} 
                onChange={(e) => setFormData({...formData, description: e.target.value})} 
                rows={2}
                placeholder="Brief description of this SLA policy"
              />
            </div>

            <div className="space-y-2">
              <Label>Uptime Guarantee (%) *</Label>
              <Input 
                type="number" 
                step="0.01"
                min="90"
                max="100"
                value={formData.uptime_percentage} 
                onChange={(e) => setFormData({...formData, uptime_percentage: parseFloat(e.target.value)})} 
                required 
              />
            </div>

            <div className="space-y-2">
              <Label>Ticket Response Time (hours)</Label>
              <Input 
                type="number" 
                min="0"
                value={formData.ticket_response_time_hours} 
                onChange={(e) => setFormData({...formData, ticket_response_time_hours: parseFloat(e.target.value)})} 
              />
            </div>

            <div className="space-y-2">
              <Label>Ticket Resolution Time (hours)</Label>
              <Input 
                type="number" 
                min="0"
                value={formData.ticket_resolution_time_hours} 
                onChange={(e) => setFormData({...formData, ticket_resolution_time_hours: parseFloat(e.target.value)})} 
              />
            </div>

            <div className="space-y-2">
              <Label>Critical Issue Response (hours)</Label>
              <Input 
                type="number" 
                min="0"
                value={formData.critical_issue_response_hours} 
                onChange={(e) => setFormData({...formData, critical_issue_response_hours: parseFloat(e.target.value)})} 
              />
            </div>

            <div className="space-y-2">
              <Label>Outage Notification (minutes)</Label>
              <Input 
                type="number" 
                min="0"
                value={formData.outage_notification_minutes} 
                onChange={(e) => setFormData({...formData, outage_notification_minutes: parseFloat(e.target.value)})} 
              />
            </div>

            <div className="space-y-2">
              <Label>Service Credit on Breach (%)</Label>
              <Input 
                type="number" 
                min="0"
                max="100"
                value={formData.penalty_percentage} 
                onChange={(e) => setFormData({...formData, penalty_percentage: parseFloat(e.target.value)})} 
              />
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label>Priority Support Access</Label>
              <Switch
                checked={formData.priority_support}
                onCheckedChange={(checked) => setFormData({ ...formData, priority_support: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>Dedicated Support Representative</Label>
              <Switch
                checked={formData.dedicated_support}
                onCheckedChange={(checked) => setFormData({ ...formData, dedicated_support: checked })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700">
              {isLoading ? 'Saving...' : sla ? 'Update Policy' : 'Create Policy'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}