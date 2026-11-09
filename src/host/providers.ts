export interface ProviderIdentity { source: string; uuid: string }
export const providerKey = (provider: ProviderIdentity) => JSON.stringify([provider.source, provider.uuid]);
export const findProvider = (providers: ProviderIdentity[], key: string) => providers.find(provider => providerKey(provider) === key);
