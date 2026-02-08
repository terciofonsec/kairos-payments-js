import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

const production = !process.env.ROLLUP_WATCH;

export default [
  // ESM build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/kairos.esm.js',
      format: 'esm',
      sourcemap: true
    },
    plugins: [
      resolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: true,
        declarationDir: './dist'
      })
    ],
    external: ['react', 'react-dom', 'react/jsx-runtime']
  },
  // CJS build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/kairos.cjs.js',
      format: 'cjs',
      sourcemap: true,
      exports: 'named'
    },
    plugins: [
      resolve(),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' })
    ],
    external: ['react', 'react-dom', 'react/jsx-runtime']
  },
  // UMD/Browser build (minified)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/kairos.min.js',
      format: 'umd',
      name: 'Kairos',
      sourcemap: true,
      globals: {
        react: 'React',
        'react-dom': 'ReactDOM',
        'react/jsx-runtime': 'jsxRuntime'
      }
    },
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' }),
      production && terser()
    ],
    external: ['react', 'react-dom', 'react/jsx-runtime']
  }
];
