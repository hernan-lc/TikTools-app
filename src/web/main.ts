import { createApp } from 'vue';
import App from './App.vue';
import { installControlEventBridge } from './components/ui/control-events.ts';
import './styles.css';

declare global {
  interface Window {
    ipc?: { postMessage: (message: string) => void };
  }
}

installControlEventBridge();
const app = createApp(App);
app.mount('#app');
// The native window remains hidden until Vue has mounted successfully. This
// host-only signal is deliberately separate from the normal page IPC model.
window.ipc?.postMessage(JSON.stringify({ type: 'frontend-ready' }));
