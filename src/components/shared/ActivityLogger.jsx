import { vibelink } from '@/api/vibelinkClient';

/**
 * ActivityLogger - Centralized logging utility for tracking all user actions
 * Automatically captures user details and timestamps
 */
export class ActivityLogger {
  
  /**
   * Log an activity to the SystemLog entity
   * @param {Object} params - Logging parameters
   * @param {string} params.action - Action performed (e.g., 'created', 'updated', 'deleted')
   * @param {string} params.category - Category of action
   * @param {string} params.level - Log level (info, warning, error, debug)
   * @param {string} params.details - Detailed description
   * @param {Object} params.changes - Before/after state for updates
   * @param {string} params.entityType - Related entity type
   * @param {string} params.entityId - Related entity ID
   * @param {string} params.entityName - Name of the affected entity
   */
  static async log({
    action,
    category,
    level = 'info',
    details,
    changes = null,
    entityType = null,
    entityId = null,
    entityName = null
  }) {
    try {
      // Get current user info
      const user = await vibelink.auth.me();
      
      // Create log entry
      await vibelink.entities.SystemLog.create({
        action,
        category,
        level,
        user_email: user.email,
        user_name: user.full_name,
        user_role: user.role,
        details,
        changes,
        entity_type: entityType,
        entity_id: entityId,
        entity_name: entityName
      });
    } catch (error) {
      console.error('Failed to log activity:', error);
      // Don't throw - logging failure shouldn't break the main operation
    }
  }

  // Convenience methods for common operations
  static async logCreate(category, entityType, entity, details = '') {
    return this.log({
      action: 'created',
      category,
      level: 'info',
      details: details || `Created new ${entityType}`,
      entityType,
      entityId: entity.id,
      entityName: entity.name || entity.full_name || entity.title || entity.id
    });
  }

  static async logUpdate(category, entityType, entityId, oldData, newData, details = '') {
    return this.log({
      action: 'updated',
      category,
      level: 'info',
      details: details || `Updated ${entityType}`,
      changes: {
        before: oldData,
        after: newData
      },
      entityType,
      entityId,
      entityName: newData.name || newData.full_name || newData.title || entityId
    });
  }

  static async logDelete(category, entityType, entity, details = '') {
    return this.log({
      action: 'deleted',
      category,
      level: 'warning',
      details: details || `Deleted ${entityType}`,
      entityType,
      entityId: entity.id,
      entityName: entity.name || entity.full_name || entity.title || entity.id
    });
  }

  static async logStatusChange(category, entityType, entity, oldStatus, newStatus, details = '') {
    return this.log({
      action: 'status_changed',
      category,
      level: 'info',
      details: details || `Changed ${entityType} status from ${oldStatus} to ${newStatus}`,
      changes: {
        before: { status: oldStatus },
        after: { status: newStatus }
      },
      entityType,
      entityId: entity.id,
      entityName: entity.name || entity.full_name || entity.title || entity.id
    });
  }

  static async logPayment(paymentData, details = '') {
    return this.log({
      action: 'payment_recorded',
      category: 'payment',
      level: 'info',
      details: details || `Payment of ${paymentData.amount} recorded`,
      entityType: 'Payment',
      entityId: paymentData.id,
      entityName: `Payment ${paymentData.reference_number || paymentData.id}`
    });
  }

  static async logInvoice(action, invoice, details = '') {
    return this.log({
      action,
      category: 'invoice',
      level: 'info',
      details: details || `Invoice ${action}`,
      entityType: 'Invoice',
      entityId: invoice.id,
      entityName: invoice.invoice_number
    });
  }

  static async logAuth(action, details = '') {
    return this.log({
      action,
      category: 'auth',
      level: 'info',
      details
    });
  }

  static async logError(category, error, context = '') {
    return this.log({
      action: 'error',
      category,
      level: 'error',
      details: `Error: ${error.message}. Context: ${context}`
    });
  }
}

export default ActivityLogger;