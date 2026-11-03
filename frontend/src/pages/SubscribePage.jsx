import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import LoginModal from "../components/LoginModal";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

// ─── Individual Plans ─────────────────────────────────────────────────────────
const INDIVIDUAL_PLANS = [
  {
    id: "free",
    name: "Free / Fan",
    monthlyPrice: 0,
    annualPrice: 0,
    description: "Follow your favorite teams and players.",
    features: [
      "Player profiles — career stats, team history",
      "Game recaps and box scores",
      "Franchise / program overviews",
      "League standings and tournament results",
    ],
    cta: "Get Started Free",
    ctaStyle: "border border-gray-600 text-gray-300 hover:border-gray-400 hover:text-white",
    highlight: false,
    priceKeys: null,
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: 8,
    annualPrice: 80,
    description: "For serious fans and fantasy players.",
    features: [
      "Everything in Free",
      "Advanced metrics and efficiency ratings",
      "Detailed per-game logs",
      "Throwing tendency heat maps (where data available)",
      "Shot / receiving zone charts",
      "Cross-season player comparison tools",
    ],
    cta: "Start Pro",
    ctaStyle: "bg-emerald-600 hover:bg-emerald-500 text-white",
    highlight: true,
    priceKeys: {
      monthly: "VITE_STRIPE_PRICE_PRO_MONTHLY",
      annual:  "VITE_STRIPE_PRICE_PRO_ANNUAL",
    },
  },
  {
    id: "analyst",
    name: "Analyst",
    monthlyPrice: 15,
    annualPrice: 150,
    description: "Deep research tools for coaches and independent scouts.",
    features: [
      "Everything in Pro",
      "Full data export (CSV, PDF)",
      "Cross-league player comparison (college → club → pro)",
      "Career trajectory modeling",
      "Saved player watchlists and custom reports",
    ],
    cta: "Start Analyst",
    ctaStyle: "bg-sky-600 hover:bg-sky-500 text-white",
    highlight: false,
    priceKeys: {
      monthly: "VITE_STRIPE_PRICE_ANALYST_MONTHLY",
      annual:  "VITE_STRIPE_PRICE_ANALYST_ANNUAL",
    },
  },
];

// ─── Team Plans ───────────────────────────────────────────────────────────────
const TEAM_PLANS = [
  {
    id: "hs_team",
    name: "High School",
    badge: "Always Free",
    badgeColor: "bg-teal-700",
    monthlyPrice: 0,
    annualPrice: 0,
    seats: "Unlimited",
    description: "Free forever for high school programs.",
    features: [
      "Player profiles and game recaps",
      "Roster management",
      "Basic opponent lookup",
    ],
    note: "No scouting reports or data export.",
    cta: "Register Free",
    ctaStyle: "border border-gray-600 text-gray-300 hover:border-gray-400 hover:text-white",
    highlight: false,
    priceKeys: null,
  },
  {
    id: "college_team",
    name: "College",
    badge: null,
    badgeColor: null,
    monthlyPrice: 29,
    annualPrice: 290,
    seats: 3,
    reportNote: "1 tournament report / mo included",
    extraTeam: "$15 / team report",
    extraTournament: "$35 / tournament report",
    description: "Full analytics suite for college programs.",
    features: [
      "Everything in Analyst tier (all seats)",
      "Opponent scouting — profiles, heat maps, previous programs",
      "Opponent roster history and competition level context",
      "Player recruitment scouting (eligibility, position, region)",
      "Pro league data passthrough on player profiles",
      "Head-to-head historical matchup data",
      "Transfer / roster movement tracker",
      "3 staff / coach seat licenses",
    ],
    cta: "Start College Plan",
    ctaStyle: "bg-amber-600 hover:bg-amber-500 text-white",
    highlight: false,
    priceKeys: {
      monthly: "VITE_STRIPE_PRICE_COLLEGE_MONTHLY",
      annual:  "VITE_STRIPE_PRICE_COLLEGE_ANNUAL",
    },
  },
  {
    id: "club_team",
    name: "Club",
    badge: null,
    badgeColor: null,
    monthlyPrice: 79,
    annualPrice: 790,
    seats: 5,
    reportNote: "1 tournament report / mo included",
    extraTeam: "$25 / team report",
    extraTournament: "$55 / tournament report",
    description: "Advanced scouting and recruitment for club programs.",
    features: [
      "Everything in College tier",
      "Opponent performance trends (season-over-season)",
      "Cross-division player lookup (college → club pipeline)",
      "Positional versatility scoring",
      "Depth chart projection (1–2 season forecast)",
      "Turnover tendency profiling by situation",
      "Weather / field condition performance correlation",
      "5 staff / captain seat licenses",
    ],
    cta: "Start Club Plan",
    ctaStyle: "bg-indigo-600 hover:bg-indigo-500 text-white",
    highlight: true,
    priceKeys: {
      monthly: "VITE_STRIPE_PRICE_CLUB_MONTHLY",
      annual:  "VITE_STRIPE_PRICE_CLUB_ANNUAL",
    },
  },
  {
    id: "pro_team",
    name: "Pro League",
    badge: "Pro",
    badgeColor: "bg-violet-700",
    monthlyPrice: 199,
    annualPrice: 1990,
    seats: 10,
    reportNote: "35 player profiles / mo",
    extraPlayer: "$5 / player over cap",
    description: "Full recruitment platform for professional franchises.",
    features: [
      "35 player profiles / mo from full college + club pool",
      "Search by position, region, stats, eligibility, age",
      "Full career history across all programs and leagues",
      "Recruitment packet export per player (PDF)",
      "Unlimited saved watchlist",
      "10 staff seat licenses",
      "All Club reports + full pro-tier variants",
    ],
    cta: "Start Pro League Plan",
    ctaStyle: "bg-violet-600 hover:bg-violet-500 text-white",
    highlight: false,
    priceKeys: {
      monthly: "VITE_STRIPE_PRICE_PRO_TEAM_MONTHLY",
      annual:  "VITE_STRIPE_PRICE_PRO_TEAM_ANNUAL",
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getStripeId(plan, billing) {
  if (!plan.priceKeys) return null;
  const key = billing === "annual" ? plan.priceKeys.annual : plan.priceKeys.monthly;
  return import.meta.env[key] ?? null;
}

function priceDisplay(plan, billing) {
  if (plan.monthlyPrice === 0) return { main: "$0", suffix: "forever", note: null };
  if (billing === "annual") {
    const mo = Math.round(plan.annualPrice / 12);
    return { main: `$${mo}`, suffix: "/mo", note: `$${plan.annualPrice}/yr — 2 months free` };
  }
  return { main: `$${plan.monthlyPrice}`, suffix: "/mo", note: null };
}

// ─── Plan Card ────────────────────────────────────────────────────────────────
function PlanCard({ plan, billing, onSelect, loadingPlan, currentTier }) {
  const { main, suffix, note } = priceDisplay(plan, billing);
  const isCurrentPlan = currentTier === plan.id;
  const isBusy = loadingPlan === plan.id;

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-5 gap-4 ${
        plan.highlight
          ? "border-emerald-500 shadow-lg shadow-emerald-950/60"
          : "border-gray-700"
      } bg-gray-900`}
    >
      {plan.highlight && (
        <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-emerald-600 text-xs font-bold tracking-wide whitespace-nowrap">
          Most Popular
        </span>
      )}
      {plan.badge && !plan.highlight && (
        <span className={`absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full ${plan.badgeColor} text-xs font-bold tracking-wide whitespace-nowrap`}>
          {plan.badge}
        </span>
      )}

      {/* Header */}
      <div>
        <h3 className="text-sm font-bold text-white uppercase tracking-wide">{plan.name}</h3>
        <div className="mt-1.5 flex items-end gap-1 flex-wrap">
          <span className="text-3xl font-extrabold text-white leading-none">{main}</span>
          <span className="text-gray-400 text-sm mb-0.5">{suffix}</span>
        </div>
        {note && <p className="text-xs text-emerald-400 mt-1">{note}</p>}
        {plan.seats != null && (
          <p className="text-xs text-gray-500 mt-0.5">
            {typeof plan.seats === "number" ? `${plan.seats} seat licenses` : `${plan.seats} seats`}
          </p>
        )}
        {plan.reportNote && (
          <p className="text-xs text-gray-500 mt-0.5">{plan.reportNote}</p>
        )}
        <p className="text-gray-400 text-xs mt-2 leading-relaxed">{plan.description}</p>
      </div>

      {/* Features */}
      <ul className="flex-1 flex flex-col gap-1.5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-xs text-gray-300 leading-snug">
            <span className="text-emerald-400 shrink-0 mt-0.5">✓</span>
            {f}
          </li>
        ))}
        {plan.note && (
          <li className="text-xs text-gray-500 mt-1 italic">{plan.note}</li>
        )}
      </ul>

      {/* Add-on pricing */}
      {(plan.extraTeam || plan.extraTournament || plan.extraPlayer) && (
        <div className="border-t border-gray-800 pt-3 flex flex-col gap-1">
          {plan.extraTeam && (
            <p className="text-xs text-gray-500">Add-on: <span className="text-gray-300">{plan.extraTeam}</span></p>
          )}
          {plan.extraTournament && (
            <p className="text-xs text-gray-500">Add-on: <span className="text-gray-300">{plan.extraTournament}</span></p>
          )}
          {plan.extraPlayer && (
            <p className="text-xs text-gray-500">{plan.extraPlayer}</p>
          )}
        </div>
      )}

      {/* CTA */}
      <button
        onClick={() => onSelect(plan)}
        disabled={!!loadingPlan || isCurrentPlan}
        className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
          isCurrentPlan
            ? "border border-gray-700 text-gray-600 cursor-default"
            : plan.ctaStyle
        }`}
      >
        {isBusy ? "Loading…" : isCurrentPlan ? "Current Plan" : plan.cta}
      </button>
    </div>
  );
}

// ─── Subscribe Page ───────────────────────────────────────────────────────────
export default function SubscribePage() {
  const { user, token }           = useAuth();
  const navigate                  = useNavigate();
  const [billing, setBilling]     = useState("monthly");
  const [showLogin, setShowLogin] = useState(false);
  const [loading, setLoading]     = useState(null);
  const [error, setError]         = useState(null);

  async function handleSelect(plan) {
    setError(null);
    if (plan.monthlyPrice === 0) { navigate("/"); return; }
    if (!user) { setShowLogin(true); return; }

    const priceId = getStripeId(plan, billing);
    if (!priceId) {
      setError(`The ${plan.name} plan is not yet available for direct purchase. Contact us to get started.`);
      return;
    }

    setLoading(plan.id);
    try {
      const origin = window.location.origin;
      const res = await fetch(`${API_BASE}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          price_id:    priceId,
          success_url: `${origin}/account?checkout=success`,
          cancel_url:  `${origin}/subscribe`,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Could not start checkout.");
      }
      window.location.href = (await res.json()).url;
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  }

  async function handleManage() {
    setLoading("portal");
    try {
      const res = await fetch(`${API_BASE}/api/stripe/portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ return_url: window.location.href }),
      });
      if (!res.ok) throw new Error("Could not open billing portal.");
      window.location.href = (await res.json()).url;
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  }

  const currentTier = user?.tier ?? "free";
  const hasPaidSub  = !["free", "hs_team"].includes(currentTier);

  return (
    <div className="min-h-screen bg-gray-950 text-white px-4 py-16">
      {showLogin && (
        <LoginModal onClose={() => setShowLogin(false)} onSuccess={() => setShowLogin(false)} />
      )}

      <div className="max-w-7xl mx-auto">

        {/* ── Header ── */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-3">Analytics for Every Level of the Game</h1>
          <p className="text-gray-400 max-w-xl mx-auto text-sm">
            From casual fan to professional front office — find the plan that fits your game.
          </p>

          {/* Monthly / Annual toggle */}
          <div className="inline-flex items-center gap-1 mt-6 bg-gray-900 border border-gray-700 rounded-xl p-1">
            <button
              onClick={() => setBilling("monthly")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                billing === "monthly" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBilling("annual")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                billing === "annual" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              Annual
              <span className="bg-emerald-800 text-emerald-200 text-xs px-1.5 py-0.5 rounded-full font-semibold">
                2 months free
              </span>
            </button>
          </div>
        </div>

        {error && <p className="text-center text-red-400 mb-8 text-sm">{error}</p>}

        {/* ── Individual Plans ── */}
        <section className="mb-16">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-white">Individual Plans</h2>
            <p className="text-gray-500 text-sm">For fans, analysts, and independent scouts.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {INDIVIDUAL_PLANS.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                billing={billing}
                onSelect={handleSelect}
                loadingPlan={loading}
                currentTier={currentTier}
              />
            ))}
          </div>
        </section>

        {/* ── Team Plans ── */}
        <section className="mb-12">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-white">Team Plans</h2>
            <p className="text-gray-500 text-sm">
              Org accounts for coaches, captains, and front-office staff. Roster management is free for all teams.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            {TEAM_PLANS.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                billing={billing}
                onSelect={handleSelect}
                loadingPlan={loading}
                currentTier={currentTier}
              />
            ))}
          </div>
        </section>

        {/* ── Reports note ── */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 mb-10 text-xs text-gray-400 leading-relaxed">
          <p className="text-sm font-semibold text-gray-300 mb-2">Available Reports</p>
          <p>
            Tournament · Team · Season Recap · Historical Matchup · Tournament Performance · Roster Continuity ·
            Eligibility · Player Comparison · Player vs. Player Matchup ·{" "}
            <span className="text-gray-500">Breakout Player (Club / Pro only)</span>
          </p>
          <p className="mt-2 text-gray-500">
            College and Club plans include 1 report credit per month. Additional reports and extra team slots are
            billed per use. High School programs always have access to basic player and roster tools at no cost.
          </p>
        </div>

        {/* ── Manage subscription ── */}
        {hasPaidSub && (
          <div className="text-center">
            <button
              onClick={handleManage}
              disabled={loading === "portal"}
              className="text-sm text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors disabled:opacity-50"
            >
              {loading === "portal" ? "Opening portal…" : "Manage or cancel your subscription →"}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
