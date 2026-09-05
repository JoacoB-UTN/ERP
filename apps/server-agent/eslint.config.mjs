// @ts-check
import globals from 'globals';
import { baseConfig } from '@erp/eslint-config';

export default [
  ...baseConfig,
  {
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs',
    },
  },
];
