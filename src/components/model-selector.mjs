import {
  buildModelOptionRecords,
  chooseRecommendedModel,
  describeModelDiscoveryError,
  normalizeModelRecords
} from './model-discovery.mjs';

export {
  buildModelOptionRecords,
  chooseRecommendedModel,
  describeModelDiscoveryError,
  normalizeModelRecords
};

export function populateModelSelect(select, {
  models = [],
  remote = false,
  selectedModel = '',
  includeCustom = true
} = {}) {
  if (!select) return;
  const records = buildModelOptionRecords({ models, remote });
  const options = records.map(record => {
    const option = document.createElement('option');
    option.value = record.id;
    option.textContent = record.label;
    return option;
  });
  if (includeCustom) {
    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = '自定义模型';
    options.push(custom);
  }
  select.replaceChildren(...options);
  const requested = String(selectedModel || '').trim();
  select.value = records.some(record => record.id === requested) ? requested : 'custom';
}

export function syncCustomModelInput(select, input, { value = '' } = {}) {
  if (!select || !input) return;
  const custom = select.value === 'custom';
  input.style.display = custom ? 'block' : 'none';
  if (custom && value && !input.value) input.value = value;
}

export function readSelectedModel(select, input) {
  if (!select) return '';
  return select.value === 'custom'
    ? String(input?.value || '').trim()
    : String(select.value || '').trim();
}
