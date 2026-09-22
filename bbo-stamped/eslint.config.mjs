import next from 'eslint-config-next';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...next,
  {
    rules: {
      // Every image here is a user-supplied data URL held in local state, so the
      // Next image pipeline has nothing to optimise.
      '@next/next/no-img-element': 'off',
    },
  },
];

export default config;
