import { register } from 'node:module';
import 'fake-indexeddb/auto';
register('./env-loader.js', import.meta.url);
