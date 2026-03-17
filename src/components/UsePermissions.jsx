import { useEffect, useState } from 'react';
import { vibelink } from '@/api/vibelinkClient';

export function usePermissions() {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUserPermissions = async () => {
      try {
        const currentUser = await vibelink.auth.me();
        setUser(currentUser);

        if (currentUser?.staff_role_id) {
          const roles = await vibelink.entities.Role.list();
          const userRole = roles.find(r => r.id === currentUser.staff_role_id);
          setPermissions(userRole?.permissions || []);
        } else if (currentUser?.role === 'super_admin') {
          // Super admins have all permissions
          setPermissions(['*']);
        } else if (currentUser?.role === 'admin') {
          // Regular admins have broad access (can be customized)
          setPermissions(['*']);
        }
      } catch (error) {
        console.error('Failed to load user permissions:', error);
      } finally {
        setLoading(false);
      }
    };

    loadUserPermissions();
  }, []);

  const hasPermission = (permissionCode) => {
    if (loading) return false;
    if (!user) return false;
    if (permissions.includes('*')) return true;
    if (user?.role === 'super_admin') return true;
    return permissions.includes(permissionCode);
  };

  const hasAllPermissions = (permissionCodes) => {
    return permissionCodes.every(code => hasPermission(code));
  };

  const hasAnyPermission = (permissionCodes) => {
    return permissionCodes.some(code => hasPermission(code));
  };

  return {
    user,
    permissions,
    loading,
    hasPermission,
    hasAllPermissions,
    hasAnyPermission,
  };
}