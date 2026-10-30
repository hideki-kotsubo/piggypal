import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import './styles/tokens.css'
import './index.css'
import './styles/home.css'
import './styles/shell.css'
import './lib/settings' // applies stored theme-mode before first paint
import './lib/i18n' // picks the UI language before first paint (docs/73)
import './lib/installPrompt' // captures beforeinstallprompt before React mounts (docs/56 D201)
import App from './App.tsx'
import { StoreProvider } from './lib/store'
import { TransactionList } from './components/TransactionList'
import { TransactionScreen } from './components/TransactionScreen'
import { DuplicateTransactionsScreen } from './components/DuplicateTransactionsScreen'
import { InboxScreen } from './components/InboxScreen'
import { AccountsScreen } from './components/AccountsScreen'
import { AccountScreen } from './components/AccountScreen'
import { CategoriesScreen } from './components/CategoriesScreen'
import { SchedulesScreen } from './components/SchedulesScreen'
import { ScheduleScreen } from './components/ScheduleScreen'
import { InsightsScreen } from './components/InsightsScreen'
import { SettingsScreen } from './components/SettingsScreen'
import { SyncSettingsScreen } from './components/SyncSettingsScreen'
import { AppearanceScreen, EntrySettingsScreen, LanguageScreen } from './components/PreferenceScreens'
import { PairingScreen } from './components/PairingScreen'
import { HouseholdScreen } from './components/HouseholdScreen'
import { DeleteAccountScreen } from './components/DeleteAccountScreen'
import { PinScreen } from './components/PinScreen'
import { DeviceLinkScreen } from './components/DeviceLinkScreen'
import { ScanDeviceLinkScreen } from './components/ScanDeviceLinkScreen'
import { AboutScreen } from './components/AboutScreen'
import { AuthVerifyScreen } from './components/AuthVerifyScreen'
import { AppShell } from './components/AppShell'
import { SlotSplit, SplitLayout } from './components/SplitLayout'

// Universal Links (iOS) / App Links (Android) hand the tapped magic-link's
// full https://<app-domain>/... URL to the native shell here — this app
// always runs from its own bundled webDir (capacitor:// on iOS,
// https://localhost on Android), never that host, so only the path+query
// are meaningful. A full reassignment (not react-router's navigate) is
// deliberate: this fires before React has necessarily mounted anything
// meaningful yet on a cold app-open via link, and the app's local-first
// SQLite (db.ts) makes a fresh load cheap and safe either way.
if (Capacitor.isNativePlatform()) {
  void CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    const { pathname, search } = new URL(url)
    window.location.href = pathname + search
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <Routes>
          {/* docs/80 — rail + top bar on wide windows; a no-op on phones. */}
          <Route element={<AppShell />}>
            <Route path="/" element={<App />} />
            {/* docs/80 D313/D314 — list + detail side by side on wide windows. */}
            <Route path="/transactions/duplicates" element={<DuplicateTransactionsScreen />} />
            <Route path="/transactions" element={<SplitLayout list={<TransactionList />} base="/transactions" emptyKey="split.transaction" />}>
              <Route path=":id" element={<TransactionScreen />} />
            </Route>
            <Route path="/inbox" element={<SplitLayout list={<InboxScreen />} base="/inbox" emptyKey="split.inbox" />}>
              <Route path=":id" element={<TransactionScreen />} />
            </Route>
            <Route path="/insights" element={<InsightsScreen />} />
            <Route path="/settings" element={<SplitLayout list={<SettingsScreen />} base="/settings" emptyKey="split.settings" />}>
              <Route path="sync" element={<SyncSettingsScreen />} />
              <Route path="appearance" element={<AppearanceScreen />} />
              <Route path="language" element={<LanguageScreen />} />
              <Route path="entry" element={<EntrySettingsScreen />} />
              <Route path="pair" element={<PairingScreen />} />
              <Route path="household" element={<HouseholdScreen />} />
              <Route path="household/link-device" element={<DeviceLinkScreen />} />
              <Route path="household/pin" element={<PinScreen />} />
              <Route path="delete-account" element={<DeleteAccountScreen />} />
              <Route path="about" element={<AboutScreen />} />
              {/* docs/71 — the old Profiles screen folded into Household. */}
              <Route path="profiles" element={<Navigate to="/settings/household" replace />} />
            </Route>
            <Route path="/about" element={<Navigate to="/settings/about" replace />} />
            <Route path="/auth/verify" element={<AuthVerifyScreen />} />
            <Route path="/auth/scan" element={<ScanDeviceLinkScreen />} />
            <Route path="/accounts" element={<SplitLayout list={<AccountsScreen />} base="/accounts" emptyKey="split.account" />}>
              <Route path=":id" element={<AccountScreen />} />
            </Route>
            <Route path="/categories" element={<SlotSplit emptyKey="split.category"><CategoriesScreen /></SlotSplit>} />
            <Route path="/schedules" element={<SplitLayout list={<SchedulesScreen />} base="/schedules" emptyKey="split.schedule" />}>
              <Route path=":id" element={<ScheduleScreen />} />
            </Route>
          </Route>
        </Routes>
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
)
