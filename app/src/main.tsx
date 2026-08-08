import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './styles/tokens.css'
import './index.css'
import './styles/home.css'
import App from './App.tsx'
import { StoreProvider } from './lib/store'
import { TransactionList } from './components/TransactionList'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/transactions" element={<TransactionList />} />
        </Routes>
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
)
