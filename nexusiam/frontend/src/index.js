import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Apply theme synchronously before ANY React code runs
(function() {
  try {
    const t = localStorage.getItem('nexusiam_theme') || 'dark';
    if (t === 'light') {
      document.body.classList.add('theme-light');
    } else {
      document.body.classList.remove('theme-light');
    }
  } catch(e) {}
})();

const root = ReactDOM.createRoot(document.getElementById('root'));
// No StrictMode - prevents double mount which resets theme
root.render(<App />);
