import { vibelink } from '@/api/vibelinkClient';

/**
 * AI-powered ticket routing system
 * Analyzes ticket content and assigns to the most appropriate staff member
 */
export async function routeTicket(ticketData, customers, users, tickets, roles, slas) {
  try {
    const customer = customers.find(c => c.id === ticketData.customer_id);
    const customerPlan = customer?.plan_name;
    const customerSLA = customer?.plan_id ? slas.find(s => s.id === customer.plan_id) : null;
    
    // Get staff members with permissions to handle tickets
    const staffMembers = users.filter(u => {
      if (u.role === 'admin' && !u.staff_role_id) return true; // Full admin
      const staffRole = roles.find(r => r.id === u.staff_role_id);
      return staffRole?.permissions?.includes('tickets.manage') || 
             staffRole?.permissions?.includes('tickets.view');
    });

    if (staffMembers.length === 0) {
      return null; // No staff available
    }

    // Calculate current workload for each staff member
    const workloadMap = {};
    staffMembers.forEach(staff => {
      const assignedTickets = tickets.filter(t => 
        t.assigned_to === staff.email && 
        t.status !== 'resolved' && 
        t.status !== 'closed'
      );
      workloadMap[staff.email] = assignedTickets.length;
    });

    // Prepare context for AI
    const staffContext = staffMembers.map(s => ({
      email: s.email,
      name: s.full_name,
      current_workload: workloadMap[s.email] || 0,
      role: s.role,
      staff_role_id: s.staff_role_id
    }));

    const prompt = `You are an intelligent ticket routing system for an ISP support team. Analyze this support ticket and assign it to the most appropriate staff member.

TICKET DETAILS:
- Category: ${ticketData.category}
- Priority: ${ticketData.priority}
- Subject: ${ticketData.subject}
- Description: ${ticketData.description}
- Customer Plan: ${customerPlan || 'Unknown'}
- Has SLA: ${customerSLA ? 'Yes (' + customerSLA.name + ')' : 'No'}

AVAILABLE STAFF:
${JSON.stringify(staffContext, null, 2)}

ROUTING RULES:
1. Balance workload - prefer staff with fewer assigned tickets
2. Match expertise - billing issues to staff familiar with billing, technical issues to technical staff
3. Priority tickets should go to experienced staff (admins or those with lower workload)
4. Customers with SLA agreements should get priority routing
5. If multiple staff are equally suitable, choose the one with lowest workload

Return the email of the best staff member to assign this ticket to, along with a brief reason.`;

    const result = await vibelink.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          assigned_staff_email: { type: "string" },
          reason: { type: "string" }
        }
      }
    });

    const assignedStaff = staffMembers.find(s => s.email === result.assigned_staff_email);
    
    if (assignedStaff) {
      return {
        assigned_to: assignedStaff.email,
        assigned_to_name: assignedStaff.full_name,
        routing_reason: result.reason
      };
    }

    return null;
  } catch (error) {
    console.error('AI ticket routing failed:', error);
    // Fallback: round-robin assignment based on workload
    const staffMembers = users.filter(u => {
      if (u.role === 'admin' && !u.staff_role_id) return true;
      const staffRole = roles.find(r => r.id === u.staff_role_id);
      return staffRole?.permissions?.includes('tickets.manage');
    });

    if (staffMembers.length === 0) return null;

    // Simple workload-based assignment
    const workloadMap = {};
    staffMembers.forEach(staff => {
      const assignedTickets = tickets.filter(t => 
        t.assigned_to === staff.email && 
        t.status !== 'resolved' && 
        t.status !== 'closed'
      );
      workloadMap[staff.email] = assignedTickets.length;
    });

    const leastBusyStaff = staffMembers.reduce((prev, curr) => 
      (workloadMap[curr.email] || 0) < (workloadMap[prev.email] || 0) ? curr : prev
    );

    return {
      assigned_to: leastBusyStaff.email,
      assigned_to_name: leastBusyStaff.full_name,
      routing_reason: 'Auto-assigned based on workload'
    };
  }
}