declare module "libsodium-wrappers-sumo" {
  type CryptoPwhash = (
    outputLength: number,
    password: string | Uint8Array,
    salt: Uint8Array,
    opslimit: number,
    memlimit: number,
    algorithm: number
  ) => Uint8Array;

  interface SodiumModule {
    ready: Promise<void>;
    crypto_pwhash: CryptoPwhash;
    crypto_pwhash_OPSLIMIT_MODERATE: number;
    crypto_pwhash_MEMLIMIT_MODERATE: number;
    crypto_pwhash_ALG_ARGON2ID13: number;
  }

  const module: SodiumModule;
  export default module;
}
