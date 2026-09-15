import ReactDOM from 'react-dom/client';

import { createApp } from '@backstage/frontend-defaults';

import plugin from '../src';

const app = createApp({ features: [plugin] });

ReactDOM.createRoot(document.getElementById('root')!).render(app.createRoot());
