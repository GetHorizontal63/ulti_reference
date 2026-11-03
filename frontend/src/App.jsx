import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './hooks/useTheme.jsx';
import { AuthProvider }        from './contexts/AuthContext.jsx';
import { USAU_ENABLED }        from './utils/features.js';
const SubscribePage = lazy(() => import('./pages/SubscribePage.jsx'));
const AccountPage = lazy(() => import('./pages/AccountPage.jsx'));
const LandingPage = lazy(() => import('./pages/LandingPage.jsx'));
const UFALandingPage = lazy(() => import('./pages/UFALandingPage.jsx'));
const HomePage = lazy(() => import('./pages/HomePage.jsx'));
const GamePage = lazy(() => import('./pages/GamePage.jsx'));
const PlayerPage = lazy(() => import('./pages/PlayerPage.jsx'));
const PlayerProfilePage = lazy(() => import('./pages/PlayerProfilePage.jsx'));
const PlayerSearchPage = lazy(() => import('./pages/PlayerSearchPage.jsx'));
const USAULandingPage = lazy(() => import('./pages/USAULandingPage.jsx'));
const USAUProgramPage = lazy(() => import('./pages/USAUProgramPage.jsx'));
const USAUDivisionPage = lazy(() => import('./pages/USAUDivisionPage.jsx'));
const USAURankingsPage = lazy(() => import('./pages/USAURankingsPage.jsx'));
const USAULeaderboardPage = lazy(() => import('./pages/USAULeaderboardPage.jsx'));
const UFATeamsPage = lazy(() => import('./pages/UFATeamsPage.jsx'));
const UFATeamPage = lazy(() => import('./pages/UFATeamPage.jsx'));
const UFAComparePage = lazy(() => import('./pages/UFAComparePage.jsx'));
const UFAThrowChartPage = lazy(() => import('./pages/UFAThrowChartPage.jsx'));
const UFALeaderboardPage = lazy(() => import('./pages/UFALeaderboardPage.jsx'));
const BlogPage = lazy(() => import('./pages/BlogPage.jsx'));
const BlogPostPage = lazy(() => import('./pages/BlogPostPage.jsx'));
const WULLandingPage = lazy(() => import('./pages/WULLandingPage.jsx'));
const WULTeamsPage = lazy(() => import('./pages/WULTeamsPage.jsx'));
const WULTeamPage = lazy(() => import('./pages/WULTeamPage.jsx'));
const WULComparePage = lazy(() => import('./pages/WULComparePage.jsx'));
const PULLandingPage = lazy(() => import('./pages/PULLandingPage.jsx'));
const PULTeamsPage = lazy(() => import('./pages/PULTeamsPage.jsx'));
const PULTeamPage = lazy(() => import('./pages/PULTeamPage.jsx'));
const PULComparePage = lazy(() => import('./pages/PULComparePage.jsx'));
const MLULandingPage = lazy(() => import('./pages/MLULandingPage.jsx'));
const MLUTeamsPage = lazy(() => import('./pages/MLUTeamsPage.jsx'));
const MLUTeamPage = lazy(() => import('./pages/MLUTeamPage.jsx'));
const MLUComparePage = lazy(() => import('./pages/MLUComparePage.jsx'));
const MLUGamesPage = lazy(() => import('./pages/MLUGamesPage.jsx'));
const MLUGamePage = lazy(() => import('./pages/MLUGamePage.jsx'));
const WULGamesPage = lazy(() => import('./pages/WULGamesPage.jsx'));
const WULGamePage = lazy(() => import('./pages/WULGamePage.jsx'));
const PULGamesPage = lazy(() => import('./pages/PULGamesPage.jsx'));
const PULGamePage = lazy(() => import('./pages/PULGamePage.jsx'));
const UFAGamesPage = lazy(() => import('./pages/UFAGamesPage.jsx'));
const UFAGamePage = lazy(() => import('./pages/UFAGamePage.jsx'));
const USAUGamesPage = lazy(() => import('./pages/USAUGamesPage.jsx'));
const USAUGamePage = lazy(() => import('./pages/USAUGamePage.jsx'));
const USAUTournamentsPage = lazy(() => import('./pages/USAUTournamentsPage.jsx'));
const GameReportPage = lazy(() => import('./pages/GameReportPage.jsx'));
const PlayerReportPage = lazy(() => import('./pages/PlayerReportPage.jsx'));
const TeamReportPage = lazy(() => import('./pages/TeamReportPage.jsx'));
const StatusPage = lazy(() => import('./pages/StatusPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const SubmitUltiAnalyticsPage = lazy(() => import('./pages/SubmitUltiAnalyticsPage.jsx'));

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Suspense fallback={null}>
        <Routes>
          <Route path="/"                element={<LandingPage />} />
          <Route path="/ufa"             element={<UFALandingPage />} />
          <Route path="/game/:slug"      element={<GamePage />} />
          <Route path="/player/:id"      element={<PlayerPage />} />
          <Route path="/players"         element={<PlayerSearchPage />} />
          <Route path="/players/:id"     element={<PlayerProfilePage />} />
          <Route path="/ufa/teams"           element={<UFATeamsPage />} />
          <Route path="/ufa/teams/:franchiseId" element={<UFATeamPage />} />
          <Route path="/ufa/compare"         element={<UFAComparePage />} />
          <Route path="/ufa/throws"          element={<UFAThrowChartPage />} />
          <Route path="/ufa/leaderboard"     element={<UFALeaderboardPage />} />
          <Route path="/blog"              element={<BlogPage />} />
          <Route path="/blog/:postId"      element={<BlogPostPage />} />
          <Route path="/wul"                    element={<WULLandingPage />} />
          <Route path="/wul/teams"              element={<WULTeamsPage />} />
          <Route path="/wul/teams/:franchiseId" element={<WULTeamPage />} />
          <Route path="/wul/compare"            element={<WULComparePage />} />
          <Route path="/pul"                    element={<PULLandingPage />} />
          <Route path="/pul/teams"              element={<PULTeamsPage />} />
          <Route path="/pul/teams/:teamName"    element={<PULTeamPage />} />
          <Route path="/pul/compare"            element={<PULComparePage />} />
          <Route path="/mlu"                    element={<MLULandingPage />} />
          <Route path="/mlu/teams"              element={<MLUTeamsPage />} />
          <Route path="/mlu/teams/:franchiseId" element={<MLUTeamPage />} />
          <Route path="/mlu/compare"            element={<MLUComparePage />} />
          <Route path="/mlu/games"              element={<MLUGamesPage />} />
          <Route path="/mlu/games/:gameId"      element={<MLUGamePage />} />
          <Route path="/wul/games"              element={<WULGamesPage />} />
          <Route path="/wul/games/:gameId"      element={<WULGamePage />} />
          <Route path="/pul/games"              element={<PULGamesPage />} />
          <Route path="/pul/games/:gameId"      element={<PULGamePage />} />
          <Route path="/ufa/games"              element={<UFAGamesPage />} />
          <Route path="/ufa/games/:gameId"      element={<UFAGamePage />} />
          <Route path="/report/game/:league/:gameId" element={<GameReportPage />} />
          <Route path="/report/player/:playerId"     element={<PlayerReportPage />} />
          <Route path="/report/team/:league/:teamId"  element={<TeamReportPage />} />
          <Route path="/status"                  element={<StatusPage />} />
          <Route path="/admin"                   element={<AdminPage />} />
          <Route path="/submit/ultianalytics"    element={<SubmitUltiAnalyticsPage />} />
          <Route path="/subscribe"               element={<SubscribePage />} />
          <Route path="/account"                 element={<AccountPage />} />
          {/* USAU hidden until a common player/team ID exists — see utils/features.js */}
          {USAU_ENABLED && (
            <>
            <Route path="/usau"             element={<USAULandingPage />} />
            <Route path="/usau/program/:programId" element={<USAUProgramPage />} />
            <Route path="/usau/club"         element={<USAUDivisionPage division="club" />} />
            <Route path="/usau/college"      element={<USAUDivisionPage division="college" />} />
            <Route path="/usau/youth"        element={<USAUDivisionPage division="youth" />} />
            <Route path="/usau/leaderboard"  element={<USAULeaderboardPage />} />
            <Route path="/usau/tournaments"      element={<USAUTournamentsPage />} />
            <Route path="/usau/games"             element={<USAUGamesPage />} />
            <Route path="/usau/games/:gameId"     element={<USAUGamePage />} />
            </>
          )}
          <Route path="*"                element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}