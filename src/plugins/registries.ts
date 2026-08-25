import type { Disposable, AudioProvider, TTSProvider } from './types.ts';

interface RegisteredProvider<T> {
  owner: string;
  provider: T;
}

abstract class ProviderRegistry<T extends { id: string; name: string; priority?: number }> {
  readonly #providers = new Map<string, RegisteredProvider<T>>();

  protected registerProvider(owner: string, provider: T): Disposable {
    if (!/^[a-z0-9][a-z0-9._-]{1,127}$/.test(provider.id)) {
      throw new Error(`Provider id is invalid: ${provider.id}`);
    }
    if (!provider.name.trim()) throw new Error(`Provider ${provider.id} must have a name.`);
    if (this.#providers.has(provider.id)) throw new Error(`Provider is already registered: ${provider.id}`);
    const entry = { owner, provider };
    this.#providers.set(provider.id, entry);
    return {
      dispose: () => {
        if (this.#providers.get(provider.id) === entry) this.#providers.delete(provider.id);
      },
    };
  }

  protected unregisterOwner(owner: string): void {
    for (const [id, entry] of this.#providers) if (entry.owner === owner) this.#providers.delete(id);
  }

  protected getRegistered(id?: string): RegisteredProvider<T> | undefined {
    if (id) return this.#providers.get(id);
    return [...this.#providers.values()]
      .sort((left, right) => (right.provider.priority ?? 0) - (left.provider.priority ?? 0)
        || left.provider.id.localeCompare(right.provider.id))[0];
  }

  protected listRegistered(): Array<RegisteredProvider<T>> {
    return [...this.#providers.values()]
      .sort((left, right) => left.provider.id.localeCompare(right.provider.id));
  }

  protected async stopRegistered(): Promise<void> {
    await this.stopEntries(this.#providers.values());
  }

  protected async stopRegisteredOwner(owner: string): Promise<void> {
    await this.stopEntries([...this.#providers.values()].filter((entry) => entry.owner === owner));
  }

  private async stopEntries(entries: Iterable<RegisteredProvider<T>>): Promise<void> {
    for (const { provider } of entries) {
      const stop = 'stopAll' in provider && typeof provider.stopAll === 'function'
        ? provider.stopAll
        : 'stop' in provider && typeof provider.stop === 'function'
          ? provider.stop
          : undefined;
      if (stop) {
        try { await stop.call(provider); } catch { /* provider shutdown must not block other providers */ }
      }
    }
  }
}

export class AudioProviderRegistry extends ProviderRegistry<AudioProvider> {
  register(owner: string, provider: AudioProvider): Disposable {
    if (provider.capabilities.length === 0) throw new Error(`Audio provider ${provider.id} must declare a capability.`);
    return this.registerProvider(owner, provider);
  }

  override unregisterOwner(owner: string): void { this.unregisterOwnerInternal(owner); }

  getProvider(id?: string): AudioProvider | undefined { return this.getRegistered(id)?.provider; }

  getPlaybackProvider(id?: string): AudioProvider | undefined {
    if (id) {
      const provider = this.getRegistered(id)?.provider;
      return provider?.capabilities.includes('playback') ? provider : undefined;
    }
    return this.listRegistered().map((entry) => entry.provider)
      .filter((provider) => provider.capabilities.includes('playback'))
      .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id))[0];
  }

  list(): Array<{ owner: string; provider: AudioProvider }> {
    return this.listRegistered().map((entry) => ({ owner: entry.owner, provider: entry.provider }));
  }

  async stopAll(): Promise<void> { await this.stopRegistered(); }

  async stopOwner(owner: string): Promise<void> { await this.stopRegisteredOwner(owner); }

  private unregisterOwnerInternal(owner: string): void { super.unregisterOwner(owner); }
}

export class TTSProviderRegistry extends ProviderRegistry<TTSProvider> {
  register(owner: string, provider: TTSProvider): Disposable {
    return this.registerProvider(owner, provider);
  }

  override unregisterOwner(owner: string): void { this.unregisterOwnerInternal(owner); }

  getProvider(id?: string): TTSProvider | undefined { return this.getRegistered(id)?.provider; }

  list(): Array<{ owner: string; provider: TTSProvider }> {
    return this.listRegistered().map((entry) => ({ owner: entry.owner, provider: entry.provider }));
  }

  async stopAll(): Promise<void> { await this.stopRegistered(); }

  async stopOwner(owner: string): Promise<void> { await this.stopRegisteredOwner(owner); }

  private unregisterOwnerInternal(owner: string): void { super.unregisterOwner(owner); }
}
