import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { vibelink } from '@/api/vibelinkClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, 
  Users, 
  Wifi,
  FileText, 
  CreditCard,
  MessageSquare,
  Send,
  BarChart3,
  Settings,
  Menu,
  X,
  LogOut,
  ChevronRight,
  ChevronDown,
  Zap,
  Shield,
  AlertTriangle,
  DollarSign,
  Moon,
  Sun
} from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import NotificationBell from '@/components/notifications/NotificationBell';
import OnboardingTour from '@/components/onboarding/OnboardingTour';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const navigation = [
  { name: 'Dashboard', href: 'Dashboard', icon: LayoutDashboard, permission: null },
  { name: 'Tenants', href: 'Tenants', icon: Users, permission: null },
  { name: 'Customers', href: 'Customers', icon: Users, permission: null },
  { name: 'Customer Onboarding', href: 'CustomerOnboarding', icon: Users, permission: null },
  { name: 'Service Plans', href: 'ServicePlans', icon: Wifi, permission: null },
  { name: 'Hotspots', href: 'Hotspots', icon: Wifi, permission: null },
  { name: 'Hotspot Files', href: 'HotspotFileManager', icon: FileText, permission: null },
  { name: 'MikroTik Routers', href: 'MikrotikManagement', icon: Wifi, permission: null },
  { name: 'IP Address Pool', href: 'IPAddressPool', icon: Wifi, permission: null },
  { 
    name: 'Network & SLA', 
    icon: Shield, 
    permission: null,
    children: [
      { name: 'Outages', href: 'Outages', icon: AlertTriangle, permission: null },
      { name: 'SLA', href: 'SLA', icon: Shield, permission: null },
    ]
  },
  { 
    name: 'Billing & Finance', 
    icon: CreditCard, 
    permission: null,
    children: [
      { name: 'Subscriptions', href: 'Subscriptions', icon: CreditCard, permission: null },
      { name: 'Invoices', href: 'Invoices', icon: FileText, permission: null },
      { name: 'Finance', href: 'Finance', icon: DollarSign, permission: null },
      { name: 'Reports', href: 'Reports', icon: BarChart3, permission: null },
      { name: 'Tenant Billing', href: 'TenantBilling', icon: CreditCard, permission: null },
      { name: 'Billing Analytics', href: 'TenantBillingAnalytics', icon: BarChart3, permission: null },
    ]
  },
  { name: 'Support Tickets', href: 'Tickets', icon: MessageSquare, permission: null },
  { name: 'Analytics', href: 'Analytics', icon: BarChart3, permission: null },
  { name: 'Messages', href: 'Messages', icon: Send, permission: null },
  { name: 'Knowledge Base', href: 'KnowledgeBase', icon: FileText, permission: null },
  { 
    name: 'Administration', 
    icon: Shield, 
    permission: null,
    children: [
      { name: 'Super Admin', href: 'SuperAdmin', icon: Shield, permission: null },
      { name: 'Roles', href: 'Administration', tab: 'roles', icon: Shield, permission: null },
      { name: 'Staff', href: 'Administration', tab: 'staff', icon: Users, permission: null },
      { name: 'Logs', href: 'Logs', icon: FileText, permission: null },
    ]
  },
  { name: 'Settings', href: 'Settings', icon: Settings, permission: null },
  { name: 'Security', href: 'Security', icon: Shield, permission: null },
  ];

// Pages that should not use the admin layout
const portalPages = ['CustomerPortal'];

export default function Layout({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, updateMe, logout } = useAuth();
  const [expandedSections, setExpandedSections] = useState({});
  const location = useLocation();

  const { data: hotspots = [] } = useQuery({
    queryKey: ['hotspots'],
    queryFn: () => vibelink.entities.Hotspot.list(),
    enabled: !!user,
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => vibelink.entities.Role.list(),
    enabled: !!user,
  });

  // Get user permissions
  const isAdmin = user?.role === 'admin';
  const staffRole = user?.staff_role_id ? roles.find(r => r.id === user.staff_role_id) : null;
  const userPermissions = staffRole?.permissions || [];

  const hasPermission = (permission) => {
    if (!permission) return true; // No permission required
    if (permission === 'super_admin') return user?.role === 'super_admin'; // Super admin only
    if (isAdmin && !user?.staff_role_id) return true; // Admin without role has all access
    return userPermissions.includes(permission);
  };

  // Filter navigation based on permissions
  const filteredNavigation = navigation
    .filter(item => hasPermission(item.permission))
    .map(item => {
      if (item.children) {
        return {
          ...item,
          children: item.children.filter(child => hasPermission(child.permission))
        };
      }
      return item;
    })
    .filter(item => !item.children || item.children.length > 0);

  const isActivePage = (pageName) => {
    return currentPageName === pageName;
  };

  const toggleSection = (name) => {
    setExpandedSections(prev => ({
      ...prev,
      [name]: !prev[name]
    }));
  };

  const isChildActive = (children) => {
    return children?.some(child => currentPageName === child.href);
  };

  const handleLogout = () => {
    logout();
  };

  return (
    <>
      <OnboardingTour user={user} updateMe={updateMe} />
      <LayoutContent 
        children={children} 
        currentPageName={currentPageName}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        user={user}
        expandedSections={expandedSections}
        toggleSection={toggleSection}
        isActivePage={isActivePage}
        isChildActive={isChildActive}
        handleLogout={handleLogout}
        filteredNavigation={filteredNavigation}
        hotspots={hotspots}
        portalPages={portalPages}
      />
    </>
  );
}

function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  
  return (
    <Button 
      variant="ghost" 
      size="icon"
      onClick={toggleTheme}
      className="rounded-full"
    >
      {theme === 'dark' ? (
        <Sun className="w-5 h-5 text-yellow-500" />
      ) : (
        <Moon className="w-5 h-5 text-slate-700 dark:text-slate-300" />
      )}
    </Button>
  );
}

function LayoutContent({ 
  children, 
  currentPageName, 
  sidebarOpen, 
  setSidebarOpen, 
  user, 
  expandedSections, 
  toggleSection, 
  isActivePage, 
  isChildActive, 
  handleLogout, 
  filteredNavigation, 
  hotspots,
  portalPages
}) {
  const { theme, toggleTheme } = useTheme();

  // If this is a portal page, render without the admin layout
  if (portalPages.includes(currentPageName)) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-500">
      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 z-50 h-full w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800
        transform transition-transform duration-300 ease-in-out
        lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between h-16 px-6 border-b border-slate-100 dark:border-slate-700" data-tour="sidebar">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-slate-900 dark:text-slate-50 dark:text-white">VIBELINK</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">ISP Management</p>
              </div>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              className="lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
            {filteredNavigation.map((item) => {
              if (item.children) {
                const expanded = expandedSections[item.name];
                const hasActiveChild = isChildActive(item.children);

                return (
                  <div key={item.name}>
                    <button
                      onClick={() => toggleSection(item.name)}
                      className={`
                        w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all relative overflow-hidden group
                        ${hasActiveChild
                          ? 'bg-gradient-to-r from-indigo-50 to-purple-50 text-indigo-600 shadow-sm' 
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 hover:text-slate-900'
                        }
                      `}
                    >
                      {hasActiveChild && (
                        <motion.div
                          layoutId="activeSection"
                          className="absolute inset-0 bg-gradient-to-r from-indigo-50 to-purple-50"
                          initial={false}
                          transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                        />
                      )}
                      <item.icon className={`w-5 h-5 ${hasActiveChild ? 'text-indigo-600' : 'text-slate-400'} relative z-10 ${!hasActiveChild && 'group-hover:scale-110 transition-transform'}`} />
                      <span className="flex-1 text-left relative z-10">{item.name}</span>
                      {item.name === 'Hotspots' && hotspots.length > 0 && (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="relative z-10 px-2 py-0.5 text-xs font-bold bg-indigo-600 text-white rounded-full"
                        >
                          {hotspots.filter(h => h.status === 'active').length}
                        </motion.span>
                      )}
                      <ChevronDown className={`w-4 h-4 transition-transform relative z-10 ${expanded ? 'rotate-180' : ''}`} />
                    </button>
                    <AnimatePresence>
                      {expanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          <div className="ml-4 mt-1 space-y-1 relative">
                            <div className="absolute left-3 top-0 bottom-0 w-px bg-gradient-to-b from-indigo-200 via-purple-200 to-transparent" />
                            {item.children.map((child, idx) => {
                              const isActive = isActivePage(child.href);
                              const url = child.tab 
                                ? `${createPageUrl(child.href)}?tab=${child.tab}`
                                : createPageUrl(child.href);

                              return (
                                <motion.div
                                  key={child.name}
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: idx * 0.05 }}
                                >
                                  <Link
                                    to={url}
                                    onClick={() => setSidebarOpen(false)}
                                    className={`
                                      flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all relative group
                                      ${isActive 
                                        ? 'bg-gradient-to-r from-indigo-50 to-purple-50 text-indigo-600 shadow-sm' 
                                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 hover:text-slate-900'
                                      }
                                    `}
                                  >
                                    <child.icon className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-400'} transition-transform ${!isActive && 'group-hover:scale-110'}`} />
                                    <span className="flex-1">{child.name}</span>
                                    {isActive && (
                                      <motion.div
                                        layoutId="activeSubNav"
                                        className="w-1.5 h-1.5 rounded-full bg-indigo-600"
                                        initial={false}
                                        transition={{ type: "spring", bounce: 0.2 }}
                                      />
                                    )}
                                  </Link>
                                </motion.div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              }

              const isActive = isActivePage(item.href);
              return (
                <Link
                  key={item.name}
                  to={createPageUrl(item.href)}
                  onClick={() => setSidebarOpen(false)}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all
                    ${isActive 
                      ? 'bg-indigo-50 text-indigo-600' 
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 hover:text-slate-900'
                    }
                  `}
                >
                  <item.icon className={`w-5 h-5 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                  <span className="flex-1">{item.name}</span>
                  {isActive && (
                    <motion.div
                      layoutId="activeNav"
                      className="w-1.5 h-1.5 rounded-full bg-indigo-600"
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* User */}
          <div className="p-4 border-t border-slate-100 dark:border-slate-700">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white font-semibold">
                      {user?.full_name?.charAt(0).toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left">
                    <p className="font-medium text-slate-900 dark:text-slate-50 dark:text-white text-sm">{user?.full_name || 'User'}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user?.email || ''}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={handleLogout} className="text-rose-600">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleTheme}>
                {theme === 'dark' ? (
                  <>
                    <Sun className="w-4 h-4 mr-2" />
                    Light Mode
                  </>
                ) : (
                  <>
                    <Moon className="w-4 h-4 mr-2" />
                    Dark Mode
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              </DropdownMenuContent>
              </DropdownMenu>
              </div>
              </div>
              </aside>

      {/* Main content */}
      <div className="lg:pl-72">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-700 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-900 dark:text-slate-50 dark:text-white">VIBELINK</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell user={user} />
            <ThemeToggleButton />
          </div>
        </header>

        {/* Desktop header */}
        <header className="sticky top-0 z-30 hidden lg:flex items-center justify-end gap-4 h-16 px-6 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-700">
          <div data-tour="notifications">
            <NotificationBell user={user} />
          </div>
          <ThemeToggleButton />
        </header>

        {/* Page content */}
        <main className="min-h-[calc(100vh-4rem)] lg:min-h-screen">
          {children}
        </main>
      </div>
    </div>
  );
}