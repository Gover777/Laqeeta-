import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Google Maps Quota Listener & Script Error Handling for Demo Key
(window as any).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};
const origError = console.error;
console.error = (...args: unknown[]) => {
  origError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
};

window.addEventListener('error', (e) => {
  if (e.message === 'Script error.' || e.message?.includes('Google Maps')) {
    // Prevent unhandled global script error noise if GMaps fails to load or faces CORS/origin restriction
    e.preventDefault();
  }
});

createRoot(document.getElementById('root')!).render(<App />);

