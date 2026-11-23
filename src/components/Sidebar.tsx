import React from "react";
import {
  LayoutGrid,
  Sparkles,
  LayoutDashboard,
  Network,
  Database,
  FileText,
  History,
  ShieldCheck,
  Users,
  Settings,
  X,
  LogIn,
  UserPlus,
  LogOut
} from "lucide-react";
import { User } from "../types";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  user: User | null;
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const SIDEBAR_NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "ai-analyst", label: "AI Analyst Studio", icon: Sparkles },
  { id: "dashboard", label: "Executive Dashboard", icon: LayoutDashboard },
  { id: "graph-explorer", label: "Knowledge Graph Explorer", icon: Network },
  { id: "data-sources", label: "Data Sources & RAG", icon: Database },
  { id: "reports", label: "Executive Briefings", icon: FileText },
  { id: "history", label: "Audit Trail", icon: History },
  { id: "security-sandbox", label: "Security Sandbox", icon: ShieldCheck },
  { id: "users", label: "User Management", icon: Users },
  { id: "settings", label: "Settings", icon: Settings }
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  user,
  onLogout,
  mobileOpen,
  onCloseMobile
}) => {
  const handleSelect = (id: string) => {
    setActiveTab(id);
    onCloseMobile();
  };

  const navContent = (
    <div className="flex flex-col h-full bg-[#0B1220] text-slate-300 select-none">
      {/* Brand Header */}
      <div className="px-5 pt-6 pb-5 flex items-start justify-between">
        <button
          type="button"
          onClick={() => handleSelect(user ? "overview" : "login")}
          className="text-left focus:outline-none group"
        >
          <div className="text-[17px] font-bold tracking-tight text-white leading-tight group-hover:text-blue-300 transition-colors">
            Decision Intelligence
          </div>
          <div className="text-[11px] font-medium text-slate-400 mt-1 tracking-normal">
            Agentic AI + GraphRAG
          </div>
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1 text-slate-400 hover:text-white rounded-md"
          aria-label="Close navigation drawer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main Navigation Links */}
      <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto" aria-label="Primary Sidebar Navigation">
        {SIDEBAR_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item.id)}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap text-left ${
                isActive
                  ? "bg-[#1D63ED] text-white font-semibold shadow-sm"
                  : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-white" : "text-slate-400"}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom Auth / Account Footer */}
      <div className="px-3 py-4 border-t border-slate-800/80 space-y-1.5">
        {user ? (
          <>
            <div className="px-3 py-2 rounded-lg bg-slate-900/80 border border-slate-800/90">
              <div className="text-xs font-semibold text-white truncate">{user.name}</div>
              <div className="text-[11px] text-slate-400 truncate font-mono mt-0.5">{user.email}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                onCloseMobile();
                onLogout();
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-[13px] font-medium text-slate-300 hover:bg-slate-800/80 hover:text-rose-300 transition-colors"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>Sign Out</span>
            </button>
          </>
        ) : (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => handleSelect("login")}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                activeTab === "login"
                  ? "bg-[#1D63ED] text-white font-semibold"
                  : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
              }`}
            >
              <LogIn className="w-4 h-4 shrink-0" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              onClick={() => handleSelect("register")}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                activeTab === "register"
                  ? "bg-[#1D63ED] text-white font-semibold"
                  : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
              }`}
            >
              <UserPlus className="w-4 h-4 shrink-0" />
              <span>Create Account</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Fixed Desktop Sidebar */}
      <aside className="hidden lg:block w-60 shrink-0 border-r border-slate-900 bg-[#0B1220]">
        <div className="sticky top-0 h-screen">{navContent}</div>
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-[1px]"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative w-64 max-w-[80vw] h-full z-10 shadow-2xl">{navContent}</div>
        </div>
      )}
    </>
  );
};
