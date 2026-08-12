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
import { InboxScreen } from './components/InboxScreen'
import { AccountsScreen } from './components/AccountsScreen'
import { CategoriesScreen } from './components/CategoriesScreen'
import { SettingsScreen } from './components/SettingsScreen'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/transactions" element={<TransactionList />} />
          <Route path="/inbox" element={<InboxScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/accounts" element={<AccountsScreen />} />
          <Route path="/categories" element={<CategoriesScreen />} />
        </Routes>
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
)
