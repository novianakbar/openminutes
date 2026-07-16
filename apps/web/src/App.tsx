import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { MeetingsPage } from "./pages/MeetingsPage";
import { MeetingDetailPage } from "./pages/MeetingDetailPage";
import { MeetingLivePage } from "./pages/MeetingLivePage";
import { AudioSummariesPage } from "./pages/AudioSummariesPage";
import { AudioSummaryDetailPage } from "./pages/AudioSummaryDetailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { TranscriptionSettingsPage } from "./pages/admin/TranscriptionSettingsPage";
import { SummarySettingsPage } from "./pages/admin/SummarySettingsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/meetings" replace />} />
        <Route path="/meetings" element={<MeetingsPage />} />
        <Route path="/meetings/:id" element={<MeetingDetailPage />} />
        <Route path="/meetings/:id/live" element={<MeetingLivePage />} />
        <Route path="/summaries" element={<AudioSummariesPage />} />
        <Route path="/summaries/:id" element={<AudioSummaryDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/transcription" element={<TranscriptionSettingsPage />} />
        <Route path="/admin/summary" element={<SummarySettingsPage />} />
      </Route>
    </Routes>
  );
}
