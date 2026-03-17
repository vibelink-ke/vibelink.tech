import React, { createContext, useContext, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vibelink } from '@/api/vibelinkClient';

const PermissionsContext = createContext({
  permissions: [],
  hasPermission: () => true,
  hasAnyPermission: () => true,
  isAdmin: false,
  isLoading: true,
  user: null,
});

export function usePermissions() {
  return useContext(PermissionsContext);
}

export function PermissionsProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const currentUser = await vibelink.auth.me();
        setUser(currentUser);
      } catch (error) {
        console.error('Failed to load user:', error);
      } finally {
        setIsLoadingUser(false);
      }
    };
    loadUser();
  }, []);

  const { data: roles = [], isLoading: isLoadingRoles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => vibelink.entities.Role.list(),
    enabled: !!user,
  });

  const isAdmin = user?.role === 'admin';
  const staffRole = user?.staff_role_id ? roles.find(r => r.id === user.staff_role_id) : null;
  const permissions = staffRole?.permissions || [];

  // Admins without a specific staff role have all permissions
  const hasPermission = (permission) => {
    if (isAdmin && !user?.staff_role_id) return true;
    if (isAdmin && staffRole) return permissions.includes(permission);
    return permissions.includes(permission);
  };

  const hasAnyPermission = (permissionList) => {
    if (isAdmin && !user?.staff_role_id) return true;
    return permissionList.some(p => permissions.includes(p));
  };

  const isLoading = isLoadingUser || isLoadingRoles;

  return (
    <PermissionsContext.Provider value={{
      permissions,
      hasPermission,
      hasAnyPermission,
      isAdmin,
      isLoading,
      user,
    }}>
      {children}
    </PermissionsContext.Provider>
  );
}

// Higher-order component for protecting routes/components
export function withPermission(WrappedComponent, requiredPermission) {
  return function PermissionGuard(props) {
    const { hasPermission, isLoading } = usePermissions();

    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="animate-pulse text-slate-400">Loading...</div>
        </div>
      );
    }

    if (!hasPermission(requiredPermission)) {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <div className="w-16 h-16 rounded-full bg-rose-100 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m4-6V5a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2h8a2 2 0 002-2V9z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Access Denied</h3>
          <p className="text-slate-500">You don't have permission to view this content.</p>
        </div>
      );
    }

    return <WrappedComponent {...props} />;
  };
}

// Component for conditionally rendering based on permission
export function PermissionGate({ permission, permissions, children, fallback = null }) {
  const { hasPermission, hasAnyPermission } = usePermissions();

  if (permission && !hasPermission(permission)) {
    return fallback;
  }

  if (permissions && !hasAnyPermission(permissions)) {
    return fallback;
  }

  return children;
}