import type { RandomNumberSource } from "../domain/randomizer";

export const platformRandomNumberSource: RandomNumberSource = {
  integer(minimum, maximum) {
    const min = Math.ceil(minimum);
    const max = Math.floor(maximum);
    if (max < min) throw new Error("Invalid random range.");
    const range = max - min + 1;
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.getRandomValues) {
      const limit = Math.floor(0x100000000 / range) * range;
      const sample = new Uint32Array(1);
      do cryptoApi.getRandomValues(sample);
      while (sample[0] >= limit);
      return min + (sample[0] % range);
    }
    return min + Math.floor(Math.random() * range);
  },
};
