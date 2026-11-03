import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import LoginModal from "./LoginModal";

const TIER_RANK = { free: 0, pro: 1, team: 2 };

const TIER_LABELS = {
  pro:  "Pro",
  team: "Team",
};

/**
 * Gates content behind a subscription tier.
 *
 * Props:
 *   requiredTier  — "pro" | "team"  (required minimum tier)
 *   children      — content to show when user has access
 *   blurPreview   — if true, render a blurred/dimmed preview instead of nothing
 */
export default function PaywallBanner({ requiredTier = "pro", children, blurPreview = false }) {
  const { user, loading } = useAuth();
  const [showLogin, setShowLogin] = useState(false);

  if (loading) return null;

  const userTier  = user?.tier ?? "free";
  const hasAccess = TIER_RANK[userTier] >= TIER_RANK[requiredTier];

  if (hasAccess) return <>{children}</>;

  const label = TIER_LABELS[requiredTier] ?? requiredTier;

  return (
    <>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}

      <div className="relative">
        {/* Blurred preview */}
        {blurPreview && (
          <div className="pointer-events-none select-none blur-sm opacity-40 overflow-hidden max-h-64">
            {children}
          </div>
        )}

        {/* Paywall overlay */}
        <div
          className={`${
            blurPreview ? "absolute inset-0" : ""
          } flex flex-col items-center justify-center gap-4 rounded-2xl border border-gray-700 bg-gray-900/90 p-8 text-center`}
        >
          <div className="text-3xl">🔒</div>
          <h3 className="text-lg font-bold text-white">
            {label} Feature
          </h3>
          <p className="text-gray-400 text-sm max-w-xs">
            This feature requires a <span className="text-emerald-400 font-semibold">{label}</span> subscription.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mt-2">
            <Link
              to="/subscribe"
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors"
            >
              Upgrade to {label}
            </Link>
            {!user && (
              <button
                onClick={() => setShowLogin(true)}
                className="px-5 py-2 rounded-lg border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white text-sm font-semibold transition-colors"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
