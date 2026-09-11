import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only lantern's own tests. test/fixtures/repo/ contains synthetic source
    // and test files that exist to be *cited by* fixture ledgers; they are not
    // lantern's tests and must never be collected.
    //
    // Note the shape of this exclusion: it is precisely the mechanism lantern
    // exists to catch. It is correct here because nothing claims those files
    // are guarding anything. Whenever you write one of these, ask what a
    // ledger somewhere says about the files you just filtered out.
    include: ['test/**/*.test.ts'],
    exclude: ['test/fixtures/**', 'node_modules/**', 'dist/**'],
  },
});
