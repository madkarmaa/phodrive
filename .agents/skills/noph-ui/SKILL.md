---
name: noph-ui
description: Build, style, and troubleshoot Svelte interfaces using Noph UI, with fast official documentation lookup and supported component usage.
---

# Noph UI

Visit [the official website](https://noph.dev/) before implementing or refactoring a Noph component. Use the current examples and public API, then confirm that the installed declarations support them. This skill is a lookup guide; consult the live documentation when applying it.

## Fastest usage lookup

1. **Known component:** go directly to its page using the table below. Otherwise use the site's **Components** navigation; the menu button reveals navigation on narrow screens. Setup, themes, and icons are under **About**.
2. **Known feature or prop:** use the header's **Search the docs** field (search icon on narrow screens), or **Ctrl+K / Cmd+K**. Try an exact term such as `loadingAriaLabel`, `position-anchor`, or `pane-margin`. Results include pages and individual sections. Use the arrow keys and Enter, or click a result. Reduce the query if it returns nothing: search requires every space-separated term to match. These controls are confirmed by the official [search UI](https://github.com/cnolte/noph-ui/blob/main/src/routes/DocsSearch.svelte) and [search implementation](https://github.com/cnolte/noph-ui/blob/main/src/routes/searchDocs.ts).
3. **On the page:** use **On this page** to jump to the relevant example, **API / Attributes / Bindables**, **Methods**, **Theming**, or **Accessibility**, as available. Browser Find (`Ctrl+F` / `Cmd+F`) or the browsing tool's text search is quickest for an exact prop/token. Read the example's imports and snippet names alongside the API table; **Copy code** supplies the usage example.
4. **With a text-only browser:** open the direct page, search its text for the property, then read nearby lines. If a route fails, open the homepage and follow its component link. For discovery, use a domain-restricted web query such as `site:noph.dev/components/button loadingAriaLabel`, then open the official result. Site search needs JavaScript; its absence from a text snapshot does not mean the docs lack that feature.

| Task                         | Official page                                                                                      | First lookup                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Installation and root setup  | [Quick start](https://noph.dev/about/quick-start)                                                  | Peer requirements, theme import        |
| Palette and shared tokens    | [Theming](https://noph.dev/about/theming)                                                          | Generate your own theme, color schemes |
| Action and busy state        | [Button](https://noph.dev/components/button)                                                       | Loading, Icon, API                     |
| Icon-only action             | [Icon buttons](https://noph.dev/components/icon-button)                                            | Accessibility, API                     |
| Short panel wait             | [Loading indicator](https://noph.dev/components/loading-indicator)                                 | Usage, Accessibility                   |
| Measured operation progress  | [Progress](https://noph.dev/components/progress)                                                   | Determinate and indeterminate examples |
| Query input and results      | [Search](https://noph.dev/components/search)                                                       | Semantics, Motion, Layout              |
| Anchored choices             | [Menu](https://noph.dev/components/menu)                                                           | Usage, Methods, Placement              |
| Selection or removable token | [Chips](https://noph.dev/components/chip)                                                          | Correct chip family, API               |
| Form input                   | [Text field](https://noph.dev/components/text-field), [Select](https://noph.dev/components/select) | Labels, validation, Bindables          |
| Header composition           | [App bar](https://noph.dev/components/app-bar)                                                     | Search variant and snippets            |

Routes generally use `/components/<kebab-case-name>` and `/about/<guide>`. Display labels may be plural while routes are singular (`Buttons` → `/components/button`, `Menus` → `/components/menu`); follow the navigation link when unsure rather than guessing.

## Implement from the public API

- Import components from `noph-ui`. Copy the documented Svelte snippet structure, using each component's actual snippet names; `start`, `end`, `trailing`, and `icon` are not interchangeable. Use reactive state for values the interface changes.
- Prefer documented props and `--np-*` tokens for appearance and behavior. Use layout wrappers for application layout. Inspect component source only when docs and types cannot explain a behavior; selectors targeting private descendants can break on upgrades.
- Distinguish a DOM reference (`bind:element`) from a component instance (`bind:this`). A property listed in a props interface is not necessarily bindable; confirm the component declaration or docs' Bindables section.
- Preserve accessible labels when responsive layouts hide visible text. Check the component's Accessibility section before adding custom keyboard handling or roles.

Read [component-patterns.md](references/component-patterns.md) when working on loading states, search, menus, chips, forms, icons, or theme integration. It records the less obvious usage details without duplicating the full docs.

## Confirm API support quickly

Find the installed package through the package manager/editor's dependency navigation; inspect its `package.json` exports, peer dependencies, and the corresponding declaration files. In a conventional install these are under `node_modules/noph-ui/dist`:

- `index.d.ts`: exported component names.
- `<component>/types.d.ts`: props, snippets, native attribute forwarding.
- `<component>/<Component>.svelte.d.ts`: exported methods and bindable keys.
- The corresponding `.svelte` file: behavior or token defaults when declarations cannot answer the question.

Use `rg --files` to locate these files and `rg -n` for the exact prop/token and `@deprecated`. These are files to read, not executable paths. If current docs describe an API missing locally, use a supported equivalent or assess a dependency update with its peer requirements and release notes. Do not bypass the type mismatch with a cast or silently assume the website matches the installed API.
