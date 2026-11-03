import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const TIER_DISPLAY = {
  free:         { label: "Free / Fan",     color: "text-gray-400" },
  pro:          { label: "Pro",            color: "text-emerald-400" },
  analyst:      { label: "Analyst",        color: "text-sky-400" },
  hs_team:      { label: "High School",    color: "text-teal-400" },
  college_team: { label: "College Team",   color: "text-amber-400" },
  club_team:    { label: "Club Team",      color: "text-indigo-400" },
  pro_team:     { label: "Pro League",     color: "text-violet-400" },
};

export default function AccountPage() {
  const { user, loading, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Refresh tier after Stripe checkout redirect
  useEffect(() => {
    if (params.get("checkout") === "success") {
      refresh();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">Loading…</div>;
  }

  if (!user) {
    navigate("/");
    return null;
  }

  const tier = TIER_DISPLAY[user.tier] ?? TIER_DISPLAY.free;

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white px-4 py-16">
      <div className="max-w-lg mx-auto">
        <h1 className="text-3xl font-bold mb-8">My Account</h1>

        <div className="rounded-2xl border border-gray-700 bg-gray-900 p-6 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">Email</span>
            <span className="text-white text-sm">{user.email}</span>
          </div>

          {user.display_name && (
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Display Name</span>
              <span className="text-white text-sm">{user.display_name}</span>
            </div>
          )}

          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">Subscription</span>
            <span className={`text-sm font-semibold ${tier.color}`}>{tier.label}</span>
          </div>

          <div className="border-t border-gray-700 pt-4 flex flex-col gap-3">
            {["free", "hs_team"].includes(user.tier) && (
              <Link
                to="/subscribe"
                className="w-full text-center py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors"
              >
                Upgrade Plan
              </Link>
            )}
            {!["free", "hs_team"].includes(user.tier) && (
              <Link
                to="/subscribe"
                className="w-full text-center py-2 rounded-lg border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white text-sm font-semibold transition-colors"
              >
                Manage Subscription
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="w-full py-2 rounded-lg border border-gray-700 hover:border-red-600 text-gray-400 hover:text-red-400 text-sm font-semibold transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
