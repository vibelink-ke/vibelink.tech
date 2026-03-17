import { vibelink } from '@/api/vibelinkClient';

/**
 * Logs an audit event to the SystemLog entity.
 * @param {object} options
 * @param {string} options.action - Short action label e.g. "Role Created"
 * @param {string} options.category - SystemLog category enum
 * @param {string} options.level - info | warning | error
 * @param {string} options.details - Human-readable description
 * @param {string} [options.entity_type] - e.g. "Role", "User"
 * @param {string} [options.entity_id]
 * @param {string} [options.entity_name]
 * @param {object} [options.changes] - { before, after }
 * @param {object} user - current user object from vibelink.auth.me()
 */
export async function auditLog({ action, category, level = 'info', details, entity_type, entity_id, entity_name, changes }, user) {
  try {
    await vibelink.entities.SystemLog.create({
      action,
      category,
      level,
      details,
      entity_type,
      entity_id,
      entity_name,
      changes,
      user_email: user?.email || 'unknown',
      user_name: user?.full_name || 'Unknown',
      user_role: user?.role || 'unknown',
    });
  } catch (e) {
    console.error('Failed to write audit log:', e);
  }
}