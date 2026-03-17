/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import Administration from './pages/Administration';
import Analytics from './pages/Analytics';
import CustomerOnboarding from './pages/CustomerOnboarding';
import CustomerPortal from './pages/CustomerPortal';
import CustomerProfile from './pages/CustomerProfile';
import Customers from './pages/Customers';
import Dashboard from './pages/Dashboard';
import Finance from './pages/Finance';
import Hotspots from './pages/Hotspots';
import IPAddressPool from './pages/IPAddressPool';
import Invoices from './pages/Invoices';
import KnowledgeBase from './pages/KnowledgeBase';
import Logs from './pages/Logs';
import Messages from './pages/Messages';
import Outages from './pages/Outages';
import Reports from './pages/Reports';
import Roles from './pages/Roles';
import SLA from './pages/SLA';
import Security from './pages/Security';
import ServicePlans from './pages/ServicePlans';
import SetPassword from './pages/SetPassword';
import Settings from './pages/Settings';
import Subscriptions from './pages/Subscriptions';
import SuperAdmin from './pages/SuperAdmin';
import TenantBilling from './pages/TenantBilling';
import TenantBillingAnalytics from './pages/TenantBillingAnalytics';
import TenantOnboarding from './pages/TenantOnboarding';
import TenantSignup from './pages/TenantSignup';
import Tenants from './pages/Tenants';
import Tickets from './pages/Tickets';
import HotspotFileManager from './pages/HotspotFileManager';
import MikrotikManagement from './pages/MikrotikManagement';
import Login from './pages/Login';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Administration": Administration,
    "Analytics": Analytics,
    "CustomerOnboarding": CustomerOnboarding,
    "CustomerPortal": CustomerPortal,
    "CustomerProfile": CustomerProfile,
    "Customers": Customers,
    "Dashboard": Dashboard,
    "Finance": Finance,
    "Hotspots": Hotspots,
    "IPAddressPool": IPAddressPool,
    "Invoices": Invoices,
    "KnowledgeBase": KnowledgeBase,
    "Logs": Logs,
    "Messages": Messages,
    "Outages": Outages,
    "Reports": Reports,
    "Roles": Roles,
    "SLA": SLA,
    "Security": Security,
    "ServicePlans": ServicePlans,
    "SetPassword": SetPassword,
    "Settings": Settings,
    "Subscriptions": Subscriptions,
    "SuperAdmin": SuperAdmin,
    "TenantBilling": TenantBilling,
    "TenantBillingAnalytics": TenantBillingAnalytics,
    "TenantOnboarding": TenantOnboarding,
    "TenantSignup": TenantSignup,
    "Tenants": Tenants,
    "Tickets": Tickets,
    "HotspotFileManager": HotspotFileManager,
    "MikrotikManagement": MikrotikManagement,
    "Login": Login,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};