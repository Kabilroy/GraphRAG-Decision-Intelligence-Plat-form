import React, { useState, useEffect } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff
} from "lucide-react";
import { Role, User } from "../types";

interface RegisterPageProps {
  onRegisterSuccess: (user: User) => void;
  onNavigateToLogin: (prefillEmail?: string) => void;
  prefillEmail?: string;
  onBackToWorkspace?: () => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({
  onRegisterSuccess,
  onNavigateToLogin,
  prefillEmail = "",
  onBackToWorkspace
}) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(prefillEmail);
  const [company, setCompany] = useState("Nexus Industrial Enterprise");
  const [department, setDepartment] = useState("Supply Chain & Logistics");
  const [role, setRole] = useState<Role>("analyst");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [registeredUser, setRegisteredUser] = useState<User | null>(null);

  useEffect(() => {
    if (prefillEmail) {
      setEmail(prefillEmail);
    }
  }, [prefillEmail]);

  const getPasswordStrength = (pass: string) => {
    let score = 0;
    if (pass.length >= 6) score++;
    if (pass.length >= 10) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;
    return score;
  };

  const strength = getPasswordStrength(password);
  const strengthLabels = ["Weak", "Weak", "Fair", "Strong", "Strong"];
  const strengthColors = ["bg-rose-500", "bg-rose-400", "bg-amber-400", "bg-[#1D63ED]", "bg-emerald-500"];

  const handlePreFill = () => {
    setName("Elena Rostova");
    setEmail("elena.rostova@nexus-industrial.com");
    setCompany("Nexus Industrial Global");
    setDepartment("Supply Chain Resilience");
    setRole("analyst");
    setPassword("SecurePass2026!");
    setConfirmPassword("SecurePass2026!");
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim() || !email.trim() || !password) {
      setErrorMessage("Please complete all required fields.");
      return;
    }

    if (password.trim().length < 6) {
      setErrorMessage("Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Password and confirmation do not match.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          role,
          company: company.trim() || "Enterprise Workspace",
          department: department.trim() || "Operations"
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(data.error || "Registration failed.");
        setIsLoading(false);
        return;
      }

      setRegisteredUser(data.user);
      setIsLoading(false);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to contact registration server.");
      setIsLoading(false);
    }
  };

  if (registeredUser) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 bg-gradient-to-br from-[#0A1328] via-[#0E1E4A] to-[#15317B]">
        <div className="w-full max-w-[430px] bg-white rounded-2xl p-7 sm:p-8 shadow-[0_24px_60px_rgba(3,9,24,0.5)] border border-white/10">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-[19px] font-bold tracking-tight text-slate-900">
                Registration Complete
              </h1>
              <p className="text-xs text-slate-500">
                Decision Intelligence Platform · Account active
              </p>
            </div>
          </div>

          <div className="my-5 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs font-mono space-y-2">
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">User ID</span>
              <span className="text-[#1D63ED] font-semibold">{registeredUser.id}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Name</span>
              <span className="text-slate-900 text-right truncate">{registeredUser.name}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Email</span>
              <span className="text-slate-900 text-right truncate">{registeredUser.email}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Role</span>
              <span className="text-emerald-700 uppercase font-semibold">{registeredUser.role}</span>
            </div>
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => onNavigateToLogin(registeredUser.email)}
              className="w-full bg-[#1D63ED] hover:bg-[#1554D1] text-white font-semibold text-sm py-2.5 px-4 rounded-lg transition-colors whitespace-nowrap"
            >
              Proceed to Sign in
            </button>

            <button
              type="button"
              onClick={() => onRegisterSuccess(registeredUser)}
              className="w-full bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-sm py-2.5 px-4 rounded-lg transition-colors whitespace-nowrap"
            >
              Enter Platform
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 bg-gradient-to-br from-[#0A1328] via-[#0E1E4A] to-[#15317B]">
      <div className="w-full max-w-[440px] bg-white rounded-2xl p-7 sm:p-8 shadow-[0_24px_60px_rgba(3,9,24,0.5)] border border-white/10">
        {/* Card Header */}
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-bold tracking-tight text-slate-900 leading-snug">
              Decision Intelligence Platform
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Agentic AI + GraphRAG · Account registration
            </p>
          </div>
          {onBackToWorkspace && (
            <button
              type="button"
              onClick={onBackToWorkspace}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 whitespace-nowrap shrink-0 mt-1"
            >
              Back
            </button>
          )}
        </div>

        {/* Inline Error Feedback */}
        {errorMessage && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Registration Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label htmlFor="register-name" className="block text-xs font-medium text-slate-700 mb-1">
              Full name
            </label>
            <input
              id="register-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="Elena Rostova"
              autoComplete="name"
              className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#1D63ED] focus:ring-2 focus:ring-[#1D63ED]/15 transition-colors"
              required
            />
          </div>

          <div>
            <label htmlFor="register-email" className="block text-xs font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="analyst@company.example"
              autoComplete="email"
              className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#1D63ED] focus:ring-2 focus:ring-[#1D63ED]/15 transition-colors"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="register-role" className="block text-xs font-medium text-slate-700 mb-1">
                Role
              </label>
              <select
                id="register-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-[#1D63ED] focus:ring-2 focus:ring-[#1D63ED]/15 transition-colors"
              >
                <option value="analyst">Analyst</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>

            <div>
              <label htmlFor="register-department" className="block text-xs font-medium text-slate-700 mb-1">
                Department
              </label>
              <input
                id="register-department"
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Supply Chain"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#1D63ED] focus:ring-2 focus:ring-[#1D63ED]/15 transition-colors"
              />
            </div>
          </div>

          <div>
            <label htmlFor="register-password" className="block text-xs font-medium text-slate-700 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                id="register-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMessage(null);
                }}
                placeholder="Minimum 6 characters"
                autoComplete="new-password"
                className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#1D63ED] focus:ring-2 focus:ring-[#1D63ED]/15 transition-colors"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {password.length > 0 && (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${strengthColors[Math.min(strength, 4)]} transition-all duration-300`}
                    style={{ width: `${Math.max(20, (strength / 4) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-slate-500">
                  {strengthLabels[Math.min(strength, 4)]}
                </span>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="register-confirm-password" className="block text-xs font-medium text-slate-700 mb-1">
              Confirm password
            </label>
            <input
              id="register-confirm-password"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setErrorMessage(null);
              }}
              placeholder="Re-enter password"
              autoComplete="new-password"
              className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#1D63ED] focus:ring-2 focus:ring-[#1D63ED]/15 transition-colors"
              required
            />
            {confirmPassword && password !== confirmPassword && (
              <p className="text-[11px] text-rose-600 mt-1">Passwords do not match</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#1D63ED] hover:bg-[#1554D1] disabled:opacity-60 text-white font-semibold text-sm py-2.5 px-4 rounded-lg transition-colors whitespace-nowrap mt-1"
          >
            {isLoading ? "Creating account..." : "Create account"}
          </button>
        </form>

        {/* Footer Caption */}
        <p className="mt-4 text-[11px] text-slate-500 leading-relaxed">
          Roles: Admin · Analyst · Viewer · Audit trail enforced.
        </p>

        {/* Secondary Navigation */}
        <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
          <div className="text-slate-500">
            Already registered?{" "}
            <button
              type="button"
              onClick={() => onNavigateToLogin(email)}
              className="text-[#1D63ED] font-semibold hover:underline"
            >
              Sign in
            </button>
          </div>

          <button
            type="button"
            onClick={handlePreFill}
            className="text-slate-500 hover:text-[#1D63ED] font-medium whitespace-nowrap"
          >
            Pre-fill sample
          </button>
        </div>
      </div>
    </div>
  );
};
