# Noph component patterns

Consult the linked official documentation and installed declarations when applying a pattern.

## Actions and loading

Use the action's native busy state and retain its label:

```svelte
<Button loading={pending} loadingAriaLabel="Saving changes" onclick={save}>Save</Button>
```

The installed Button handles its spinner, `aria-busy`, and disabling while loading. Use `start`/`end` snippets for icons; icon-only controls need an accessible name (`title` is the documented naming/tooltip prop). For a custom square corner radius, pair `--np-button-shape` with `shape="square"`; round buttons retain their pill shape. [Button docs](https://noph.dev/components/button)

For an indeterminate panel wait, use `<LoadingIndicator aria-label="Loading files" />`. Add `contained` when a background is needed over other content. Its size token is `--np-loading-indicator-size`. Use the Progress components when reporting actual completion; an indeterminate indicator cannot communicate a measured percentage. [Loading indicator docs](https://noph.dev/components/loading-indicator)

## Search and focus geometry

Use `bind:value` for the query, `label` for its accessible name, and `inputAttributes` for attributes belonging on the input. `trailing` supplies actions. `view="docked"` and `view="full-screen"` describe results presentation; choose based on the requested interaction.

Two public tokens control horizontal focus motion: `--np-search-pane-margin` defaults to `1.5rem`, and `--np-search-view-margin` to `0.75rem`. If the design calls for constant width, set both to the same value. Overriding only the resting margin can reverse the intended expansion. First compare the wrapper and component geometry before changing internal styles.

Search results are ordinary content by default. Set `resultsAttributes` roles only when the children implement those semantics. For a selectable suggestions list with active-option keyboard behavior, look up `AutoComplete`. [Search docs](https://noph.dev/components/search)

## Menus and anchors

A menu needs both positioning and the measured anchor:

```svelte
<script lang="ts">
    import { Button, Menu, MenuItem } from 'noph-ui';

    let trigger: HTMLElement | undefined = $state();
</script>

<Button
    bind:element={trigger}
    command="toggle-popover"
    commandfor="view-options"
    style="anchor-name: --view-options"
>
    View options
</Button>
<Menu id="view-options" anchor={trigger} style="position-anchor: --view-options">
    <MenuItem>List view</MenuItem>
</Menu>
```

Use unique IDs and anchor names when repeating this pattern. CSS anchor properties place it; `anchor` lets it calculate available space. Prefer the command attributes when the trigger supports them. Otherwise use `bind:this` with `ReturnType<typeof Menu> | undefined`, then `menu?.show()` / `menu?.close()`. `bind:open` observes state; do not treat it as the opening command. Preserve native popover dismissal and MenuItem keyboard behavior. [Menu docs](https://noph.dev/components/menu)

## Chips, values, and forms

Choose the chip family by meaning: `AssistChip` performs an action, `SuggestionChip` proposes text, `FilterChip` expresses selection, and `InputChip` represents an input item. Check each family's icon, removal, and selected-state props before composing it. A menu trigger styled like a chip may still be a Button opening a Menu when that matches the interaction. [Chip docs](https://noph.dev/components/chip)

`TextField` and `Select` support `bind:value`. Use `label` or explicit accessible naming, plus `issues={[{ message: '…' }]}` for validation feedback as documented. TextField nesting in a label alone does not establish its accessible name; follow the explicit `aria-labelledby` example if wrapping it. [Text field docs](https://noph.dev/components/text-field)

`Select` takes an `options` array. `NativeSelect` instead takes `<option>` or `Option` children. Do not interchange their examples. Confirm the intended native/custom behavior and value types in the API. [Select docs](https://noph.dev/components/select)

## Theme and icons

Import a theme once at the application root. For a generated custom theme, the official Theming page's **Copy CSS** produces a complete replacement for `noph-ui/defaultTheme`: retain color roles, elevation, shape, and motion tokens. A small override may instead layer on the default theme. Keep background/text tied to matching semantic roles, including their `on-*` counterparts.

Themes use `light-dark()` pairs with `color-scheme: light dark`. Explicit light/dark selection changes `color-scheme`; the documented stylesheet uses `data-theme`. If an application already uses a different attribute, verify its CSS does the equivalent before changing its persistence scheme. Test both forced schemes and system selection. [Theming docs](https://noph.dev/about/theming)

Noph's optional `Icon` from `noph-ui/icons` needs the Material Symbols font. Components also accept SVGs, so preserve an existing SVG icon integration when suitable. This project's unplugin-icons preference is a project convention, not a Noph requirement. [Icon docs](https://noph.dev/about/icons)
