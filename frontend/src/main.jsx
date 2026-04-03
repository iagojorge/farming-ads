import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: { background: '#111827', border: '1px solid #1f2937', color: '#f9fafb' },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>,
);
