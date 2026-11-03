import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

/**
 * Modal with Login / Register tabs.
 *
 * Props:
 *   onClose  — called when the modal should close
 *   onSuccess — optional callback after successful auth, receives user object
 */
export default function LoginModal({ onClose, onSuccess }) {
  const { login, register } = useAuth();
  const [tab, setTab]         = useState("login"); // "login" | "register"
  const [email, setEmail]     = useState("");
  const [password, setPass]   = useState("");
  const [displayName, setDN]  = useState("");
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      let user;
      if (tab === "login") {
        user = await login(email, password);
      } else {
        user = await register(email, password, displayName || undefined);
      }
      onSuccess?.(user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-gray-900 border border-gray-700 shadow-2xl p-8">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl leading-none"
          aria-label="Close"
        >
          ✕
        </button>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {["login", "register"].map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(null); }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === t
                  ? "bg-emerald-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {t === "login" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {tab === "register" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDN(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPass(e.target.value)}
              placeholder={tab === "register" ? "Min 8 characters" : "Password"}
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
          >
            {loading ? "Please wait…" : tab === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
