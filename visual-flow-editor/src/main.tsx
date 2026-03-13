import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

console.log('Visual Flow Editor starting...');

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  console.log('App rendered successfully');
} catch (error) {
  console.error('Failed to render app:', error);
  document.getElementById('root')!.innerHTML = `
    <div style="padding: 20px; color: red; background: #1a1a2e;">
      <h1>Error loading app</h1>
      <pre>${error}</pre>
    </div>
  `;
}
