import next from 'eslint-config-next';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'data/**'] },
  ...next,
  {
    rules: {
      // Thumbnails are Instagram CDN URLs that expire; the Next image pipeline would cache dead links.
      '@next/next/no-img-element': 'off',
    },
  },
];

export default config;
