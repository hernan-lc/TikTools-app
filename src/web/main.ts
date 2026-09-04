import { createApp } from 'vue';
import App from './App.vue';
import { installControlEventBridge } from './components/ui/control-events.ts';
import './styles.css';

installControlEventBridge();
createApp(App).mount('#app');
