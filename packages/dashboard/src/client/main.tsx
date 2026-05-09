/* @refresh reload */
import { render } from 'solid-js/web';

import { App } from './App.js';
import './styles.css';
import './components/styles.css';

const root = document.getElementById('app');

if (!root) {
  throw new Error('dashboard mount point #app not found in index.html');
}

render(() => <App />, root);
