import { API } from '../api.js';
import { createModelDiscovery } from './model-discovery.mjs';

export const modelDiscovery = createModelDiscovery({
  listModels: options => API.listModels(options)
});
