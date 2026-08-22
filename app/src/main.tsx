import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './styles/tokens.css'
import './index.css'
import './styles/home.css'
import './lib/settings' // applies stored theme-mode before first paint
import App from './App.tsx'
import { StoreProvider } from './lib/store'
import { TransactionList } from './components/TransactionList'
import { TransactionScreen } from './components/TransactionScreen'
import { InboxScreen } from './components/InboxScreen'
import { AccountsScreen } from './components/AccountsScreen'
import { CategoriesScreen } from './components/CategoriesScreen'
import { InsightsScreen } from './components/InsightsScreen'
import { SettingsScreen } from './components/SettingsScreen'
import { PairingScreen } from './components/PairingScreen'
import { AboutScreen } from './components/AboutScreen'
import { AuthVerifyScreen } from './components/AuthVerifyScreen'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/transactions" element={<TransactionList />} />
          <Route path="/transactions/:id" element={<TransactionScreen />} />
          <Route path="/inbox" element={<InboxScreen />} />
          <Route path="/insights" element={<InsightsScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/settings/pair" element={<PairingScreen />} />
          <Route path="/auth/verify" element={<AuthVerifyScreen />} />
          <Route path="/about" element={<AboutScreen />} />
          <Route path="/accounts" element={<AccountsScreen />} />
          <Route path="/categories" element={<CategoriesScreen />} />
        </Routes>
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
)
