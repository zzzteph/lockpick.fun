import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * Emit a plain `<script>` rather than a module one.
 *
 * Vite writes `<script type="module" crossorigin>` whatever the output format, and that single
 * attribute is what stops the built game opening from `file://`: module scripts are fetched
 * under CORS rules on every scheme, and a `file://` origin is opaque, so the browser refuses
 * before it reads a byte. The bundle is already an IIFE, which needs none of that.
 *
 * `defer` keeps the original ordering guarantee — the script still runs after the document is
 * parsed, which is what `type="module"` was providing and what `#stage` depends on.
 */
function classicScriptTag(): Plugin {
  return {
    name: 'shear-line-classic-script',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/<script type="module" crossorigin src=/g, '<script defer src=')
    },
  }
}

export default defineConfig({
  plugins: [classicScriptTag()],
  server: { port: 5173, strictPort: true },
  // Relative asset paths so `dist/` runs from a subdirectory as well as a domain root.
  base: './',
  build: {
    assetsDir: 'assets',
    target: 'es2022',
    rollupOptions: {
      // The game, and only the game. `dev/audio-debug.html` is a bench instrument — the dev
      // server serves it from `dev/`, and it has no business in a shipped bundle. It also
      // cannot share one: an IIFE build takes a single input.
      input: { main: resolve(import.meta.dirname, 'index.html') },
      output: {
        /**
         * A classic script, not an ES module — `PHASES.md` Phase 14 requires `dist/` to run
         * from `file://` as well as from a static server, and relative paths alone do not get
         * you there. A `<script type="module">` is fetched under CORS rules whatever the
         * scheme, and every `file://` origin is opaque, so the browser blocks it before it
         * reads a byte: a blank canvas and a console error, on a bundle that is otherwise
         * perfectly good. An IIFE is a plain `<script>` and loads from anywhere.
         *
         * The cost is that code splitting has to go, so the audio engine is no longer a
         * separate chunk. On a 117 kB bundle that is not a trade worth arguing about, and
         * "the file I was sent opens when I double-click it" is worth a great deal.
         * See DECISIONS D-037.
         */
        format: 'iife',
      },
    },
  },
})
