import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  {
    files: ['apps/client/src/game/engine/GameEngine.ts'],
    rules: {
      // Animation pose variables intentionally stay mutable as action states grow.
      'prefer-const': 'off',
    },
  },
);
