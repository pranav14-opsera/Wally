/** Deterministic env-var configuration objects for cloud-adapter-factory tests (WO-022 AC13). */

export const localProviderEnv: Record<string, string> = {
  NODE_ENV: 'test',
  CLOUD_PROVIDER: 'local',
  DATA_ENGINE: 'postgres',
  COMPUTE_RUNNER: 'local',
  POSTGRES_DB: 'wally_test',
  POSTGRES_USER: 'wally',
  POSTGRES_PASSWORD: 'test-password',
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
  REDIS_URL: 'redis://localhost:6379',
  JWT_PRIVATE_KEY_PATH: './secrets/jwt-private.pem',
  JWT_PUBLIC_KEY_PATH: './secrets/jwt-public.pem',
  LOCAL_SECRETS_MASTER_KEY: 'a'.repeat(32),
  LOG_LEVEL: 'silent',
};

export const awsProviderEnv: Record<string, string> = {
  ...localProviderEnv,
  CLOUD_PROVIDER: 'aws',
  S3_BUCKET_NAME: 'wally-factory-test-bucket',
  AWS_REGION: 'us-east-1',
};

export const gcpProviderEnv: Record<string, string> = {
  ...localProviderEnv,
  CLOUD_PROVIDER: 'gcp',
};

export const azureProviderEnv: Record<string, string> = {
  ...localProviderEnv,
  CLOUD_PROVIDER: 'azure',
};

export const computeRunnerLocalOverrideEnv: Record<string, string> = {
  ...awsProviderEnv,
  COMPUTE_RUNNER: 'local',
};

export const computeRunnerCloudEnv: Record<string, string> = {
  ...gcpProviderEnv,
  COMPUTE_RUNNER: 'cloud',
};

/** Missing CLOUD_PROVIDER entirely — envSchema itself defaults this to 'local' (a WO-003 design predating this WO); included for completeness/documentation, not because the factory re-validates it. */
export const cloudProviderUnsetEnv: Record<string, string> = (() => {
  const { CLOUD_PROVIDER: _omit, ...rest } = localProviderEnv;
  return rest;
})();

export const invalidCloudProviderRawValue = 'openstack';
export const emptyCloudProviderRawValue = '';
