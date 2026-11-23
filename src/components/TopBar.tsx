import React from "react";
import { Menu, FileText, LogIn, UserPlus } from "lucide-react";
import { User } from "../types";
import { SIDEBAR_NAV_ITEMS } from "./Sidebar";

interface TopBarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  user: User | null;
  setUser: (u: User | null) => void;
  documents: any[];
  activeDocumentId: number;
  onSelectDocument: (id: number) => void;
  onOpenMobileMenu: () => void;
}

const EXTRA_TITLES: Record<string, string> = {
  login: "Enterprise Sign In",
  register: "Create Enterprise Account"
};

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  setActiveTab,
  user,
  setUser,
  documents,
  activeDocumentId,
  onSelectDocument,
  onOpenMobileMenu
}) => {
  const matched = SIDEBAR_NAV_ITEMS.find((i) => i.id === activeTab);
  const pageTitle = matched?.label || EXTRA_TITLES[activeTab] || "Decision Intelligence";
  const activeDoc = documents.find((d) => d.id === activeDocumentId);

  return (
    <header className="sticky top-0 z-30 h-14 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
      {/* Left: Mobile drawer button + Page Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-base sm:text-[17px] font-bold text-slate-900 tracking-tight truncate">
          {pageTitle}
        </h1>
      </div>

      {/* Right: Active Document Scope + Role Selector + Auth */}
      <div className="flex items-center gap-2.5 shrink-0">
        {user && documents.length > 0 && (
          <div className="hidden md:flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
            <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <select
              value={activeDocumentId}
              onChange={(e) => onSelectDocument(Number(e.target.value))}
              aria-label="Active target document"
              className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none max-w-[220px] truncate cursor-pointer"
              title={activeDoc?.title}
            >
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  #{d.id} · {d.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {user ? (
          <div className="flex items-center gap-2">
            <select
              value={user.role}
              onChange={(e) => setUser({ ...user, role: e.target.value as any })}
              aria-label="Workspace role"
              className="bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D63ED] text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md focus:outline-none cursor-pointer"
              title="Switch Active RBAC Role"
            >
              <option value="analyst">ANALYST</option>
              <option value="admin">ADMIN</option>
              <option value="viewer">VIEWER</option>
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("login")}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                activeTab === "login"
                  ? "bg-[#1D63ED] text-white"
                  : "text-slate-700 hover:bg-slate-100 border border-slate-200"
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("register")}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                activeTab === "register"
                  ? "bg-[#1D63ED] text-white"
                  : "bg-slate-900 text-white hover:bg-slate-800"
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Register</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
