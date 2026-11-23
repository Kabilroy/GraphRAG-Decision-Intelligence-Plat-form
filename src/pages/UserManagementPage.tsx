import React, { useEffect, useState } from "react";
import { Users, ShieldCheck, UserPlus, LogIn, RefreshCw, LogOut } from "lucide-react";
import { User, Role } from "../types";

interface UserManagementPageProps {
  user: User | null;
  setUser: (u: User | null) => void;
  onNavigateToRegister: () => void;
  onNavigateToLogin: () => void;
  onLogout: () => void;
}

export const UserManagementPage: React.FC<UserManagementPageProps> = ({
  user,
  setUser,
  onNavigateToRegister,
  onNavigateToLogin,
  onLogout
}) => {
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/users");
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err) {
      console.error("Failed to fetch users:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const rolesMatrix: { role: Role; title: string; perms: string }[] = [
    {
      role: "admin",
      title: "Admin",
      perms: "Upload datasets, inspect audit logs, run Cypher queries, and manage platform configuration."
    },
    {
      role: "analyst",
      title: "Analyst",
      perms: "Execute multi-agent investigations, inspect evidence chunks, and generate executive briefings."
    },
    {
      role: "viewer",
      title: "Viewer",
      perms: "Read-only access to dashboards, charts, and executive decision briefings."
    }
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-xs sm:text-sm text-slate-500">
          Manage enterprise accounts, active session credentials, and RBAC permission roles.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadUsers}
            disabled={isLoading}
            className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={onNavigateToLogin}
            className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Switch Account</span>
          </button>
          <button
            type="button"
            onClick={onNavigateToRegister}
            className="bg-[#1D63ED] hover:bg-[#1554D1] text-white text-xs font-semibold px-3.5 py-2 rounded-lg flex items-center gap-1.5"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Register Account</span>
          </button>
        </div>
      </div>

      {/* Current Session Card */}
      {user && (
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold text-[#1D63ED] uppercase tracking-wider">
              Current Active Session
            </span>
            <h3 className="text-base font-bold text-slate-900 mt-0.5">{user.name}</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              {user.email} · {user.company || "Enterprise"} · {user.department || "Operations"}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <select
              value={user.role}
              onChange={(e) => setUser({ ...user, role: e.target.value as Role })}
              className="bg-slate-50 border border-slate-200 text-slate-800 text-xs font-semibold rounded-lg px-3 py-2 focus:outline-none focus:border-[#1D63ED]"
            >
              <option value="admin">Role: Admin</option>
              <option value="analyst">Role: Analyst</option>
              <option value="viewer">Role: Viewer</option>
            </select>
            <button
              type="button"
              onClick={onLogout}
              className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}

      {/* Registered Users Table */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-4.5 h-4.5 text-[#1D63ED]" />
            <span>Registered Enterprise Users ({users.length})</span>
          </h3>
          <span className="text-[11px] font-mono text-slate-500">SQLite RBAC Registry</span>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Company / Unit</th>
                <th className="px-4 py-3 font-semibold">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {users.length > 0 ? (
                users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3 font-semibold text-slate-900">{u.name}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{u.email}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {u.company || "Enterprise"} · {u.department || "Operations"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="bg-blue-50 text-[#1D63ED] border border-blue-200 text-[11px] font-semibold uppercase px-2 py-0.5 rounded-md">
                        {u.role}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-500">
                    No users registered in database yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* RBAC Permissions Reference */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {rolesMatrix.map((item) => (
          <div key={item.role} className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 mb-1.5">
              <ShieldCheck className="w-4 h-4 text-[#1D63ED]" />
              <span className="text-sm font-bold text-slate-900">{item.title}</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">{item.perms}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
