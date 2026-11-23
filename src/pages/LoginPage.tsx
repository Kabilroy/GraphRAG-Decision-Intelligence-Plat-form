import React, { useState, useEffect } from "react";
import {
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { User } from "../types";

interface LoginPageProps {
  onLoginSuccess: (user: User) => void;
  onNavigateToRegister: (prefillEmail?: string) => void;
  initialEmail?: string;
  onBackToWorkspace?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onLoginSuccess,
  onNavigateToRegister,
  initialEmail = "",
  onBackToWorkspace
}) => {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isNotRegisteredError, setIsNotRegisteredError] = useState(false);
  const [registeredUsers, setRegisteredUsers] = useState<any[]>([]);
  const [showAccounts, setShowAccounts] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSuccess, setForgotSuccess] = useState(false);

  useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  const fetchRegisteredUsers = async () => {
    try {
      const res = await fetch("/api/auth/users");
      const data = await res.json();
      setRegisteredUsers(data.users || []);
    } catch (e) {
      console.error("Failed to load registered users:", e);
    }
  };

  useEffect(() => {
    fetchRegisteredUsers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsNotRegisteredError(false);

    if (!email.trim() || !password) {
      setErrorMessage("Please enter both your email and password.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password })
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.requiresRegistration || response.status === 404) {
          setIsNotRegisteredError(true);
          setErrorMessage(
            data.error || "No account found with this email. Please create an account first."
          );
        } else {
          setErrorMessage(data.error || "Authentication failed. Please check your credentials.");
        }
        setIsLoading(false);
        return;
      }

      onLoginSuccess(data.user);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to connect to authentication server.");
      setIsLoading(false);
    }
  };

  const handleSelectRegisteredAccount = (userEmail: string) => {
    setEmail(userEmail);
    setPassword("");
    setErrorMessage(null);
    setIsNotRegisteredError(false);
    setShowAccounts(false);
  };

  const handleSendReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    setForgotSuccess(true);
    setTimeout(() => {
      setShowForgotModal(false);
      setForgotSuccess(false);
      setForgotEmail("");
    }, 1800);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 bg-gradient-to-br from-[#0A1328] via-[#0E1E4A] to-[#15317B]">
      <div className="w-full max-w-[420px] bg-white rounded-2xl p-7 sm:p-8 shadow-[0_24px_60px_rgba(3,9,24,0.5)] border border-white/10">
        {/* Card Header */}
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-bold tracking-tight text-slate-900 leading-snug">
              Decision Intelligence Platform
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Agentic AI + GraphRAG · Secure sign-in
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
        {isNotRegisteredError && (
          <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-semibold text-rose-900">Account not registered</p>
                <p className="mt-0.5 leading-relaxed">
                  No account exists for <span className="font-mono font-semibold">{email}</span>.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigateToRegister(email)}
              className="w-full bg-rose-600 hover:bg-rose-700 text-white font-semibold py-1.5 px-3 rounded-md transition-colors text-xs whitespace-nowrap"
            >
              Create account with this email
            </button>
          </div>
        )}

        {errorMessage && !isNotRegisteredError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Sign-in Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-xs font-medium text-slate-700 mb-1.5">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setIsNotRegisteredError(false);
                setErrorMessage(null);
              }}
              placeholder="analyst@company.example"
              autoComplete="email"
              className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#1D63ED] focus:ring-2 focus:ring-[#1D63ED]/15 transition-colors"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="login-password" className="text-xs font-medium text-slate-700">
                Password
              </label>
              <button
                type="button"
                onClick={() => {
                  setForgotEmail(email);
                  setShowForgotModal(true);
                }}
                className="text-[11px] font-medium text-[#1D63ED] hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMessage(null);
                }}
                placeholder="••••••••••"
                autoComplete="current-password"
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
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#1D63ED] hover:bg-[#1554D1] disabled:opacity-60 text-white font-semibold text-sm py-2.5 px-4 rounded-lg transition-colors whitespace-nowrap"
          >
            {isLoading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {/* Footer Caption */}
        <p className="mt-4 text-[11px] text-slate-500 leading-relaxed">
          Roles: Admin · Analyst · Viewer · Session expires automatically.
        </p>

        {/* Secondary Navigation & Optional Account Directory */}
        <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
          <div className="text-slate-500">
            New user?{" "}
            <button
              type="button"
              onClick={() => onNavigateToRegister(email)}
              className="text-[#1D63ED] font-semibold hover:underline"
            >
              Create account
            </button>
          </div>

          {registeredUsers.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAccounts((prev) => !prev)}
              className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800 font-medium whitespace-nowrap"
            >
              <span>Accounts ({registeredUsers.length})</span>
              {showAccounts ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {showAccounts && registeredUsers.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5 max-h-40 overflow-y-auto">
            {registeredUsers.map((acc) => (
              <button
                key={acc.id}
                type="button"
                onClick={() => handleSelectRegisteredAccount(acc.email)}
                className="w-full text-left px-3 py-2 rounded-lg bg-slate-50 hover:bg-blue-50/70 border border-slate-200/80 hover:border-blue-200 transition-colors flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-slate-900 truncate block">{acc.name}</span>
                  <span className="text-[11px] text-slate-500 font-mono truncate block">{acc.email}</span>
                </div>
                <span className="text-[11px] font-mono text-slate-600 capitalize shrink-0">{acc.role}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Password Reset Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-6 shadow-2xl">
            <h2 className="text-base font-bold text-slate-900 mb-1.5 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#1D63ED]" />
              <span>Reset Password</span>
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Enter your registered work email to receive reset instructions.
            </p>

            {forgotSuccess ? (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>Reset instructions sent to your email.</span>
              </div>
            ) : (
              <form onSubmit={handleSendReset} className="space-y-4">
                <div>
                  <label htmlFor="forgot-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Email
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="analyst@company.example"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#1D63ED]"
                    required
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(false)}
                    className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold px-3.5 py-2 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-[#1D63ED] hover:bg-[#1554D1] text-white font-semibold text-xs px-4 py-2 rounded-lg whitespace-nowrap"
                  >
                    Send Reset Link
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
