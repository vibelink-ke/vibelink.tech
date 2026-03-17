import { vibelink } from '@/api/vibelinkClient';

/**
 * AI-Driven Automated Provisioning Service
 * Calls backend function to handle provisioning
 */
export async function provisionCustomerService(customer, plan, isNewCustomer = false) {
  try {
    const result = await vibelink.functions.provisionCustomer({
      customer_id: customer.id,
      plan_id: plan.id,
      is_new_customer: isNewCustomer
    });
    
    return result;
  } catch (error) {
    console.error('Provisioning error:', error);
    return { success: false, error: error.message };
  }
}

async function createNetworkConfiguration(customer, plan) {
  try {
    // Use AI to generate optimal network configuration
    const config = await vibelink.integrations.Core.InvokeLLM({
      prompt: `Generate network configuration parameters for an ISP customer:

Customer: ${customer.full_name}
Plan: ${plan.name}
Download Speed: ${plan.download_speed} Mbps
Upload Speed: ${plan.upload_speed} Mbps
Data Cap: ${plan.data_cap === 0 ? 'Unlimited' : plan.data_cap + ' GB'}
MAC Address: ${customer.mac_address || 'Not assigned'}
IP Address: ${customer.ip_address || 'Not assigned'}

Generate optimal configuration including:
- QoS (Quality of Service) settings
- Bandwidth shaping rules
- Firewall recommendations
- DNS settings
- Session timeout values

Provide practical, production-ready values.`,
      response_json_schema: {
        type: "object",
        properties: {
          qos_profile: { type: "string" },
          bandwidth_limit_download: { type: "number" },
          bandwidth_limit_upload: { type: "number" },
          session_timeout_minutes: { type: "number" },
          dns_primary: { type: "string" },
          dns_secondary: { type: "string" },
          firewall_profile: { type: "string" },
          notes: { type: "string" }
        }
      }
    });

    // Log the network configuration
    await vibelink.entities.SystemLog.create({
      action: `Network configuration generated for ${customer.full_name}`,
      category: 'system',
      level: 'info',
      details: JSON.stringify({
        customer_id: customer.id,
        plan_id: plan.id,
        configuration: config
      }),
      entity_type: 'Customer',
      entity_id: customer.id
    });

    return config;
  } catch (error) {
    console.error('Network config error:', error);
    return null;
  }
}

async function setupBillingConfiguration(customer, plan, isNewCustomer) {
  try {
    const today = new Date();
    const billingDay = customer.billing_cycle_day || 1;
    
    // Calculate first billing date
    let firstBillingDate = new Date(today.getFullYear(), today.getMonth(), billingDay);
    if (firstBillingDate < today) {
      firstBillingDate = addMonths(firstBillingDate, 1);
    }

    const billingSetup = {
      monthly_rate: plan.monthly_price,
      billing_cycle_day: billingDay,
      first_billing_date: format(firstBillingDate, 'yyyy-MM-dd'),
      setup_fee_applied: isNewCustomer && plan.setup_fee > 0,
      setup_fee_amount: isNewCustomer ? plan.setup_fee : 0
    };

    // Update customer with billing info
    await vibelink.entities.Customer.update(customer.id, {
      monthly_rate: plan.monthly_price,
      billing_cycle_day: billingDay,
      balance: isNewCustomer && plan.setup_fee > 0 ? plan.setup_fee : customer.balance || 0
    });

    // Create initial setup fee invoice if applicable
    if (isNewCustomer && plan.setup_fee > 0) {
      const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
      await vibelink.entities.Invoice.create({
        invoice_number: invoiceNumber,
        customer_id: customer.id,
        customer_name: customer.full_name,
        customer_email: customer.email,
        billing_period_start: format(today, 'yyyy-MM-dd'),
        billing_period_end: format(today, 'yyyy-MM-dd'),
        due_date: format(addMonths(today, 1), 'yyyy-MM-dd'),
        items: [
          {
            description: `${plan.name} - Setup Fee`,
            quantity: 1,
            unit_price: plan.setup_fee,
            total: plan.setup_fee
          }
        ],
        subtotal: plan.setup_fee,
        tax_rate: 0,
        tax_amount: 0,
        total_amount: plan.setup_fee,
        status: 'sent'
      });

      billingSetup.setup_invoice_created = invoiceNumber;
    }

    // Notify billing department
    const adminUsers = await vibelink.entities.User.filter({ role: 'admin' });
    for (const admin of adminUsers.slice(0, 1)) { // Notify first admin only
      await vibelink.integrations.Core.SendEmail({
        to: admin.email,
        subject: `New Customer Provisioned: ${customer.full_name}`,
        body: `
A new customer has been provisioned and is ready for billing:

Customer: ${customer.full_name}
Email: ${customer.email}
Plan: ${plan.name}
Monthly Rate: KES ${plan.monthly_price}
${isNewCustomer && plan.setup_fee > 0 ? `Setup Fee: KES ${plan.setup_fee}` : ''}
First Billing Date: ${format(firstBillingDate, 'MMMM d, yyyy')}

The customer account is now active in the billing system.
        `.trim()
      });
    }

    return billingSetup;
  } catch (error) {
    console.error('Billing setup error:', error);
    return null;
  }
}

async function sendWelcomeNotification(customer, plan, isNewCustomer) {
  try {
    const subject = isNewCustomer 
      ? `Welcome to ${plan.name}!` 
      : `Your Plan Has Been Updated to ${plan.name}`;

    const body = `
Dear ${customer.full_name},

${isNewCustomer 
  ? `Welcome! We're excited to have you as a new customer.` 
  : `Your service plan has been successfully updated.`
}

YOUR SERVICE DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Plan: ${plan.name}
${plan.description ? `Description: ${plan.description}` : ''}

Connection Speeds:
• Download: ${plan.download_speed} Mbps
• Upload: ${plan.upload_speed} Mbps
• Data: ${plan.data_cap === 0 ? 'Unlimited' : plan.data_cap + ' GB/month'}

Pricing:
• Monthly Rate: KES ${plan.monthly_price}
${isNewCustomer && plan.setup_fee > 0 ? `• One-time Setup Fee: KES ${plan.setup_fee}` : ''}

${plan.features?.length > 0 ? `
Included Features:
${plan.features.map(f => `• ${f}`).join('\n')}
` : ''}

WHAT'S NEXT:
${isNewCustomer ? `
1. Our technical team will complete your installation
2. You'll receive your connection credentials
3. Your first invoice will be generated on ${format(new Date(customer.billing_cycle_day || 1), 'MMMM d')}
` : `
1. Your new speeds will be activated within 24 hours
2. Billing will reflect the new rate from your next billing cycle
`}

Need help? Contact our support team anytime through your customer portal.

Best regards,
Your ISP Team
    `.trim();

    await vibelink.integrations.Core.SendEmail({
      to: customer.email,
      subject,
      body
    });

    return { sent: true, email: customer.email };
  } catch (error) {
    console.error('Welcome email error:', error);
    return { sent: false, error: error.message };
  }
}