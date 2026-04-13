import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { 
  MessageSquare,
  MoreVertical,
  Eye,
  CheckCircle,
  Clock,
  AlertTriangle,
  User,
  XCircle,
  ArrowRight,
  Mail,
  MessageCircle,
  Send,
  TrendingUp,
  Shield
} from 'lucide-react';
import { format, differenceInHours } from 'date-fns';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import DataTable from '@/components/shared/DataTable';
import EmptyState from '@/components/shared/EmptyState';
import SearchInput from '@/components/shared/SearchInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import AISuggestedArticles from '@/components/tickets/AISuggestedArticles';
import GenerateArticleDialog from '@/components/tickets/GenerateArticleDialog';
import CustomerMessaging from '@/components/customers/CustomerMessaging';
import AISuggestedResponse from '@/components/tickets/AISuggestedResponse';
import AITicketCategorizer from '@/components/tickets/AITicketCategorizer';
import { routeTicket } from '@/components/tickets/AITicketRouter';

const priorityIcons = {
  low: Clock,
  medium: Clock,
  high: AlertTriangle,
  urgent: AlertTriangle,
};

export default function Tickets() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [viewTicket, setViewTicket] = useState(null);
  const queryClient = useQueryClient();

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => vibelink.entities.SupportTicket.list('-created_date'),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => vibelink.entities.Customer.list(),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => vibelink.entities.User.list(),
  });

  const { data: slas = [] } = useQuery({
    queryKey: ['slas'],
    queryFn: () => vibelink.entities.SLA.list(),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['plans'],
    queryFn: () => vibelink.entities.ServicePlan.list(),
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => vibelink.entities.Role.list(),
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      // AI-powered automatic routing
      const routing = await routeTicket(data, customers, users, tickets, roles, slas);
      
      if (routing) {
        data.assigned_to = routing.assigned_to;
        data.assigned_to_name = routing.assigned_to_name;
      }
      
      const ticket = await vibelink.entities.SupportTicket.create(data);
      
      // Log the routing decision
      if (routing) {
        await vibelink.entities.TicketNote.create({
          ticket_id: ticket.id,
          note: `Auto-assigned by AI: ${routing.routing_reason}`,
          note_type: 'assignment',
          author_email: 'system',
          author_name: 'AI Router',
          is_internal: true,
        });
      }
      
      return ticket;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['tickets']);
      setShowForm(false);
      toast.success('Ticket created and automatically assigned');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => vibelink.entities.SupportTicket.update(id, data),
    onSuccess: () => queryClient.invalidateQueries(['tickets']),
  });

  const filteredTickets = tickets.filter(ticket => {
    const matchesSearch = 
      ticket.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.ticket_number?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || ticket.priority === priorityFilter;
    const matchesCategory = categoryFilter === 'all' || ticket.category === categoryFilter;
    return matchesSearch && matchesStatus && matchesPriority && matchesCategory;
  });

  const ticketStats = {
    open: tickets.filter(t => t.status === 'open').length,
    in_progress: tickets.filter(t => t.status === 'in_progress').length,
    urgent: tickets.filter(t => t.priority === 'urgent' && t.status !== 'resolved' && t.status !== 'closed').length,
    escalated: tickets.filter(t => t.escalated).length,
  };

  const columns = [
    {
      header: 'Ticket',
      cell: (row) => {
        const Icon = priorityIcons[row.priority] || Clock;
        return (
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              row.priority === 'urgent' ? 'bg-rose-50' :
              row.priority === 'high' ? 'bg-amber-50' : 'bg-slate-100 dark:bg-slate-800'
            }`}>
              <Icon className={`w-5 h-5 ${
                row.priority === 'urgent' ? 'text-rose-500' :
                row.priority === 'high' ? 'text-amber-500' : 'text-slate-500'
              }`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium text-slate-900 dark:text-slate-50">{row.ticket_number || `TKT-${row.id?.slice(0,6)}`}</p>
                {row.escalated && (
                  <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-xs">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    Escalated
                  </Badge>
                )}
                {row.sla_breach_warning && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    SLA Risk
                  </Badge>
                )}
              </div>
              <p className="text-sm text-slate-500 line-clamp-1">{row.subject}</p>
            </div>
          </div>
        );
      }
    },
    {
      header: 'Customer',
      cell: (row) => (
        <div>
          <p className="text-slate-700 dark:text-slate-300 font-medium">{row.customer_name}</p>
          {row.customer_email && (
            <p className="text-xs text-slate-500">{row.customer_email}</p>
          )}
        </div>
      )
    },
    {
      header: 'Assigned To',
      cell: (row) => (
        row.assigned_to ? (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center">
              <User className="w-3 h-3 text-indigo-600" />
            </div>
            <span className="text-sm text-slate-700 dark:text-slate-300">{row.assigned_to_name || row.assigned_to}</span>
          </div>
        ) : (
          <span className="text-sm text-slate-400 italic">Unassigned</span>
        )
      )
    },
    {
      header: 'Category',
      cell: (row) => (
        <span className="text-slate-600 dark:text-slate-400 capitalize">{row.category?.replace('_', ' ')}</span>
      )
    },
    {
      header: 'Priority',
      cell: (row) => <StatusBadge status={row.priority} />
    },
    {
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} />
    },
    {
      header: 'Created',
      cell: (row) => (
        <span className="text-sm text-slate-500">
          {row.created_date ? format(new Date(row.created_date), 'MMM d, HH:mm') : '-'}
        </span>
      )
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
            <DropdownMenuItem onClick={() => setViewTicket(row)}>
              <Eye className="w-4 h-4 mr-2" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => updateMutation.mutate({ id: row.id, data: { status: 'in_progress' }})}>
              <Clock className="w-4 h-4 mr-2" />
              Mark In Progress
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => updateMutation.mutate({ id: row.id, data: { status: 'resolved', resolved_date: new Date().toISOString() }})}>
              <CheckCircle className="w-4 h-4 mr-2" />
              Mark Resolved
            </DropdownMenuItem>
            {!row.escalated && (
              <DropdownMenuItem 
                onClick={() => updateMutation.mutate({ 
                  id: row.id, 
                  data: { 
                    escalated: true, 
                    escalated_at: new Date().toISOString(),
                    priority: row.priority === 'urgent' ? 'urgent' : 'high'
                  }
                })}
                className="text-rose-600"
              >
                <TrendingUp className="w-4 h-4 mr-2" />
                Escalate Ticket
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Support Tickets"
          subtitle={`${ticketStats.open + ticketStats.in_progress} active tickets`}
          actionLabel="Create Ticket"
          onAction={() => setShowForm(true)}
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <motion.div 
            initial={{ opacity: 0, y: 10 }} 
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-700"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{ticketStats.open}</p>
                <p className="text-xs text-slate-500">Open</p>
              </div>
            </div>
          </motion.div>
          <motion.div 
            initial={{ opacity: 0, y: 10 }} 
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-700"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{ticketStats.in_progress}</p>
                <p className="text-xs text-slate-500">In Progress</p>
              </div>
            </div>
          </motion.div>
          <motion.div 
            initial={{ opacity: 0, y: 10 }} 
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-700"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-rose-50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-rose-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{ticketStats.urgent}</p>
                <p className="text-xs text-slate-500">Urgent</p>
              </div>
            </div>
          </motion.div>
          <motion.div 
            initial={{ opacity: 0, y: 10 }} 
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-700"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{ticketStats.escalated}</p>
                <p className="text-xs text-slate-500">Escalated</p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
          <div className="flex-1 max-w-md">
            <SearchInput 
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search tickets..."
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-40 bg-white dark:bg-slate-900">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="waiting_customer">Waiting</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-full sm:w-36 bg-white dark:bg-slate-900">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priority</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-40 bg-white dark:bg-slate-900">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="billing">Billing</SelectItem>
              <SelectItem value="technical">Technical</SelectItem>
              <SelectItem value="service_request">Service Request</SelectItem>
              <SelectItem value="complaint">Complaint</SelectItem>
              <SelectItem value="general">General</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <DataTable
          columns={columns}
          data={filteredTickets}
          isLoading={isLoading}
          onRowClick={(row) => setViewTicket(row)}
          emptyState={
            <EmptyState
              icon={MessageSquare}
              title="No support tickets"
              description="Create a ticket when a customer needs assistance"
              actionLabel="Create Ticket"
              onAction={() => setShowForm(true)}
            />
          }
        />

        <TicketFormDialog
          open={showForm}
          onOpenChange={setShowForm}
          customers={customers}
          onSubmit={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
          autoRouting={true}
        />

        <TicketDetailsSheet
          ticket={viewTicket}
          open={!!viewTicket}
          onOpenChange={(open) => !open && setViewTicket(null)}
          users={users}
          customers={customers}
          slas={slas}
          plans={plans}
          onUpdate={(data) => {
            updateMutation.mutate({ id: viewTicket.id, data });
            setViewTicket({ ...viewTicket, ...data });
          }}
        />
      </div>
    </div>
  );
}

function TicketFormDialog({ open, onOpenChange, customers, onSubmit, isLoading, autoRouting }) {
  const [formData, setFormData] = useState({
    customer_id: '',
    customer_name: '',
    customer_email: '',
    subject: '',
    description: '',
    category: 'general',
    priority: 'medium',
  });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState(null);

  const handleCustomerChange = (customerId) => {
    const customer = customers.find(c => c.id === customerId);
    if (customer) {
      setFormData(prev => ({
        ...prev,
        customer_id: customerId,
        customer_name: customer.full_name,
        customer_email: customer.email,
      }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const ticketNumber = `TKT-${Date.now().toString().slice(-6)}`;
    onSubmit({
      ...formData,
      ticket_number: ticketNumber,
      status: 'open',
      // Include AI analysis metadata if available
      ...(aiAnalysis?.recommended_agent && { assigned_to: aiAnalysis.recommended_agent }),
      ...(aiAnalysis?.recommended_agent_name && { assigned_to_name: aiAnalysis.recommended_agent_name }),
    });
  };

  React.useEffect(() => {
    if (!open) {
      setFormData({
        customer_id: '',
        customer_name: '',
        customer_email: '',
        subject: '',
        description: '',
        category: 'general',
        priority: 'medium',
      });
      setShowSuggestions(false);
      setAiAnalysis(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (formData.subject && formData.description) {
      setShowSuggestions(true);
    }
  }, [formData.subject, formData.description]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Create Support Ticket
            {autoRouting && (
              <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200">
                <MessageCircle className="w-3 h-3 mr-1" />
                Auto-assign
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {autoRouting && (
            <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg flex items-start gap-2">
              <MessageCircle className="w-4 h-4 text-indigo-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-indigo-900">AI Auto-Assignment Enabled</p>
                <p className="text-xs text-indigo-700 mt-0.5">
                  This ticket will be automatically assigned to the best available staff member based on expertise and workload
                </p>
              </div>
            </div>
          )}
          {showSuggestions && (
            <>
              <AITicketCategorizer
                subject={formData.subject}
                description={formData.description}
                customerId={formData.customer_id}
                onCategorize={(analysis) => {
                  setAiAnalysis(analysis);
                  // Auto-populate category and priority based on AI analysis
                  setFormData(prev => ({
                    ...prev,
                    category: analysis.category || prev.category,
                    priority: analysis.priority || prev.priority,
                  }));
                }}
              />
              <AISuggestedArticles
                subject={formData.subject}
                description={formData.description}
                category={formData.category}
              />
            </>
          )}
          <div className="space-y-2">
            <Label>Customer *</Label>
            <Select value={formData.customer_id} onValueChange={handleCustomerChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map(customer => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Subject *</Label>
            <Input
              value={formData.subject}
              onChange={(e) => setFormData({...formData, subject: e.target.value})}
              placeholder="Brief description of the issue"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select value={formData.category} onValueChange={(v) => setFormData({...formData, category: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="billing">Billing</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                  <SelectItem value="service_request">Service Request</SelectItem>
                  <SelectItem value="complaint">Complaint</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Priority *</Label>
              <Select value={formData.priority} onValueChange={(v) => setFormData({...formData, priority: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Description *</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              placeholder="Detailed description of the issue..."
              rows={4}
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700">
              {isLoading ? 'Creating...' : 'Create Ticket'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TicketDetailsSheet({ ticket, open, onOpenChange, onUpdate, users, customers, slas, plans }) {
  const [resolution, setResolution] = useState('');
  const [noteText, setNoteText] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [showGenerateArticle, setShowGenerateArticle] = useState(false);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    const loadUser = async () => {
      const user = await vibelink.auth.me();
      setCurrentUser(user);
    };
    loadUser();
  }, []);

  const { data: notes = [] } = useQuery({
    queryKey: ['ticket-notes', ticket?.id],
    queryFn: () => vibelink.entities.TicketNote.filter({ ticket_id: ticket.id }, '-created_date'),
    enabled: !!ticket?.id,
  });

  const createNoteMutation = useMutation({
    mutationFn: (data) => vibelink.entities.TicketNote.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['ticket-notes']);
      setNoteText('');
    },
  });

  if (!ticket) return null;

  const customer = customers?.find(c => c.id === ticket.customer_id);
  const plan = customer ? plans.find(p => p.id === customer.plan_id) : null;
  const sla = plan ? slas.find(s => s.id === plan.sla_id) : null;

  // Calculate SLA metrics
  const hoursOpen = ticket.created_date ? differenceInHours(new Date(), new Date(ticket.created_date)) : 0;
  const responseBreached = sla && sla.ticket_response_time_hours && hoursOpen > sla.ticket_response_time_hours;
  const resolutionWarning = sla && sla.ticket_resolution_time_hours && hoursOpen > sla.ticket_resolution_time_hours * 0.8;

  const handleResolve = () => {
    onUpdate({
      status: 'resolved',
      resolution,
      resolved_date: new Date().toISOString(),
    });
    setResolution('');
  };

  const handleAssign = (userEmail) => {
    const user = users.find(u => u.email === userEmail);
    onUpdate({ 
      assigned_to: userEmail,
      assigned_to_name: user?.full_name || userEmail
    });
  };

  const handleStatusChange = (status) => {
    const updateData = { status };
    if (status === 'resolved') {
      updateData.resolved_date = new Date().toISOString();
    }
    onUpdate(updateData);
  };

  const handlePriorityChange = (priority) => {
    onUpdate({ priority });
  };

  const handleEscalate = () => {
    onUpdate({ 
      escalated: true,
      escalated_at: new Date().toISOString(),
      escalated_by: currentUser?.email,
      priority: ticket.priority === 'urgent' ? 'urgent' : 'high'
    });
    
    createNoteMutation.mutate({
      ticket_id: ticket.id,
      note: `Ticket escalated by ${currentUser?.full_name || currentUser?.email}`,
      note_type: 'escalation',
      author_email: currentUser?.email,
      author_name: currentUser?.full_name,
      is_internal: true,
    });
    
    toast.success('Ticket escalated successfully');
  };

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    
    createNoteMutation.mutate({
      ticket_id: ticket.id,
      note: noteText,
      note_type: 'note',
      author_email: currentUser?.email,
      author_name: currentUser?.full_name,
      is_internal: true,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Ticket Details</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-slate-50">{ticket.ticket_number}</h3>
              <p className="text-sm text-slate-500">
                Created {ticket.created_date ? format(new Date(ticket.created_date), 'MMM d, yyyy HH:mm') : '-'}
              </p>
            </div>
            <div className="flex gap-2">
              <StatusBadge status={ticket.priority} />
              <StatusBadge status={ticket.status} />
            </div>
          </div>

          {/* SLA Warnings */}
          {(responseBreached || resolutionWarning || ticket.escalated) && (
            <div className="space-y-2">
              {ticket.escalated && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-rose-600" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-rose-800">Escalated Ticket</p>
                    {ticket.escalated_at && (
                      <p className="text-xs text-rose-600">
                        Escalated {format(new Date(ticket.escalated_at), 'MMM d, HH:mm')}
                        {ticket.escalated_by && ` by ${ticket.escalated_by}`}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {responseBreached && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <div>
                    <p className="text-sm font-medium text-rose-800">SLA Response Time Breached</p>
                    <p className="text-xs text-rose-600">Expected: {sla.ticket_response_time_hours}h • Actual: {hoursOpen.toFixed(1)}h</p>
                  </div>
                </div>
              )}
              {resolutionWarning && !responseBreached && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-600" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">SLA Resolution Warning</p>
                    <p className="text-xs text-amber-600">Resolution due in {(sla.ticket_resolution_time_hours - hoursOpen).toFixed(1)}h</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Customer Info Card */}
          <div className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-bold">
                  {ticket.customer_name?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-50">{ticket.customer_name}</p>
                  <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
                    {ticket.customer_email && (
                      <span className="flex items-center gap-1">
                        <Mail className="w-3 h-3" /> {ticket.customer_email}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {customer && (
                <Link 
                  to={createPageUrl('Customers') + `?customer=${customer.id}`}
                  className="text-indigo-600 hover:text-indigo-700 text-sm font-medium flex items-center gap-1"
                >
                  View Profile <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>
            {customer && (
              <div className="mt-3 pt-3 border-t border-indigo-100 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-slate-500">Plan</p>
                  <p className="font-medium text-slate-900 dark:text-slate-50">{customer.plan_name || 'No plan'}</p>
                </div>
                <div>
                  <p className="text-slate-500">Status</p>
                  <StatusBadge status={customer.status} />
                </div>
                <div>
                  <p className="text-slate-500">Balance</p>
                  <p className={`font-medium ${(customer.balance || 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    KES {(customer.balance || 0).toFixed(2)}
                  </p>
                </div>
              </div>
            )}
            {sla && (
              <div className="mt-3 pt-3 border-t border-indigo-100">
                <div className="flex items-center gap-2 text-sm">
                  <Shield className="w-4 h-4 text-indigo-600" />
                  <span className="font-medium text-indigo-900">SLA Policy:</span>
                  <span className="text-slate-700 dark:text-slate-300">{sla.name}</span>
                </div>
              </div>
            )}
          </div>

          {/* AI Suggested Response */}
          <AISuggestedResponse
            ticket={ticket}
            onApplyResponse={(response) => {
              // Copy to clipboard and show in notes
              navigator.clipboard.writeText(response);
              setNoteText(response);
            }}
            onAutoResolve={(resolution) => {
              onUpdate({
                status: 'resolved',
                resolution,
                resolved_date: new Date().toISOString(),
              });
              toast.success('Ticket auto-resolved with AI suggestion');
            }}
          />

          {/* Subject & Description */}
          <div className="space-y-3">
            <h4 className="font-semibold text-slate-900 dark:text-slate-50">Subject</h4>
            <p className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-slate-700 dark:text-slate-300">{ticket.subject}</p>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold text-slate-900 dark:text-slate-50">Description</h4>
            <p className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{ticket.description}</p>
          </div>

          {/* Internal Notes */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                <MessageCircle className="w-4 h-4" />
                Internal Notes ({notes.length})
              </h4>
            </div>
            
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {notes.map((note, i) => (
                <motion.div
                  key={note.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`p-3 rounded-lg border ${
                    note.note_type === 'escalation' ? 'bg-rose-50 border-rose-200' :
                    note.note_type === 'assignment' ? 'bg-blue-50 border-blue-200' :
                    'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Avatar className="w-7 h-7">
                      <AvatarFallback className="text-xs bg-indigo-100 text-indigo-700">
                        {note.author_name?.charAt(0).toUpperCase() || 'S'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-50">{note.author_name || note.author_email}</span>
                        <span className="text-xs text-slate-500">
                          {note.created_date && format(new Date(note.created_date), 'MMM d, HH:mm')}
                        </span>
                        {note.note_type !== 'note' && (
                          <Badge variant="outline" className="text-xs">
                            {note.note_type}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{note.note}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="flex gap-2">
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add internal note (not visible to customer)..."
                rows={2}
                className="flex-1"
              />
              <Button 
                onClick={handleAddNote} 
                disabled={!noteText.trim() || createNoteMutation.isPending}
                size="icon"
                className="h-auto"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <Separator />

          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={ticket.status} onValueChange={handleStatusChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="waiting_customer">Waiting for Customer</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={ticket.priority} onValueChange={handlePriorityChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Assignment */}
          <div className="space-y-2">
            <Label>Assign To</Label>
            <Select value={ticket.assigned_to || ''} onValueChange={handleAssign}>
              <SelectTrigger>
                <SelectValue placeholder="Select staff member" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Unassigned</SelectItem>
                {users?.map(user => (
                  <SelectItem key={user.id} value={user.email}>
                    {user.full_name || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Escalate Button */}
          {!ticket.escalated && (
            <Button 
              variant="outline" 
              className="w-full border-rose-300 text-rose-600 hover:bg-rose-50"
              onClick={handleEscalate}
            >
              <TrendingUp className="w-4 h-4 mr-2" />
              Escalate Ticket
            </Button>
          )}

          {/* Resolution */}
          {ticket.resolution && (
            <div className="space-y-3">
              <h4 className="font-semibold text-slate-900 dark:text-slate-50">Resolution</h4>
              <p className="p-3 bg-emerald-50 rounded-lg text-slate-700 dark:text-slate-300 border border-emerald-100">{ticket.resolution}</p>
            </div>
          )}

          {/* Resolve Form */}
          {ticket.status !== 'resolved' && ticket.status !== 'closed' && (
            <div className="space-y-3 pt-4 border-t">
              <h4 className="font-semibold text-slate-900 dark:text-slate-50">Resolve Ticket</h4>
              <Textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Enter resolution details..."
                rows={3}
              />
              <div className="flex gap-3">
                <Button 
                  onClick={handleResolve} 
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  disabled={!resolution.trim()}
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Mark as Resolved
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => handleStatusChange('closed')}
                  className="text-slate-600 dark:text-slate-400"
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Close
                </Button>
              </div>
            </div>
          )}

          {/* Generate Article from Resolution */}
          {(ticket.status === 'resolved' || ticket.status === 'closed') && ticket.resolution && (
            <div className="pt-4 border-t">
              <Button
                onClick={() => setShowGenerateArticle(true)}
                variant="outline"
                className="w-full border-indigo-200 text-indigo-700 hover:bg-indigo-50"
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                Generate Knowledge Base Article
              </Button>
            </div>
          )}

          {/* Customer Messaging */}
          {customer && (
            <div className="pt-4 border-t">
              <CustomerMessaging customer={customer} />
            </div>
          )}
        </div>
      </SheetContent>

      <GenerateArticleDialog
        ticket={ticket}
        open={showGenerateArticle}
        onOpenChange={setShowGenerateArticle}
      />
    </Sheet>
  );
}