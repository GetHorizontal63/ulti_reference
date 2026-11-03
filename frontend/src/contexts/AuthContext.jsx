import { createContext, useCallback, useContext, useEffect, useState } from "react";

const AuthContext = createContext(null);

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export function AuthProvider({ children }) {
  const [user, setUser]   = useState(null);   // { id, email, display_name, tier }
  const [token, setToken] = useState(() => localStorage.getItem("afa_token"));
  const [loading, setLoading] = useState(true);

  // Validate stored token on mount
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("invalid token");
        return r.json();
      })
      .then((u) => setUser(u))
      .catch(() => {
        localStorage.removeItem("afa_token");
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (email, password) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? "Login failed.");
    }
    const data = await res.json();
    localStorage.setItem("afa_token", data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (email, password, displayName) => {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, display_name: displayName }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? "Registration failed.");
    }
    const data = await res.json();
    localStorage.setItem("afa_token", data.token);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {});
    localStorage.removeItem("afa_token");
    setToken(null);
    setUser(null);
  }, [token]);

  /** Refresh user info + tier from the server. */
  const refresh = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const u = await res.json();
      setUser(u);
    }
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
