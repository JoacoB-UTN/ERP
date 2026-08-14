// @ts-check
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { baseConfig } from './base.mjs';

export const nestjsConfig = tseslint.config(...baseConfig, {
  languageOptions: {
    globals: { ...globals.node, ...globals.jest },
    sourceType: 'commonjs',
  },
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
  },
});

export default nestjsConfig;
