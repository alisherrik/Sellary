// This plan (offline-auth) is the SOLE owner of App.tsx (merge-order Contract §3).
// Downstream plans (pos-ui, history-ui) MUST NOT rewrite this file — they only add
// nav links inside their own screens. All six routes below are pre-wired for them.
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { LoginPage } from "./pages/LoginPage";
import { CashierShell } from "./pages/CashierShell";
import { PinSetupPage } from "./pages/PinSetupPage";
import { PinUnlockPage } from "./pages/PinUnlockPage";
import { HistoryPage } from "./pages/HistoryPage";
import { CustomersPage } from "./pages/CustomersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UpdateBanner } from "./components/UpdateBanner";

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <UpdateBanner />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/cashier" element={<CashierShell />} />
        <Route path="/pin-setup" element={<PinSetupPage />} />
        <Route path="/pin-unlock" element={<PinUnlockPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/cashier" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
