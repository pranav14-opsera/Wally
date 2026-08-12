import type { ConfigRegistryEntry } from '../../adapters/data/index.js';

export type ConfigEntry = ConfigRegistryEntry;

export type ConfigDataType = 'string' | 'number' | 'boolean' | 'json';

export type CreateConfigInput = Omit<ConfigEntry, 'id' | 'created_at' | 'updated_at'>;

// data_type (and category) are immutable after creation — the AC only
// allows update() to modify value and/or description.
export type UpdateConfigInput = Partial<Pick<ConfigEntry, 'value' | 'description'>>;
