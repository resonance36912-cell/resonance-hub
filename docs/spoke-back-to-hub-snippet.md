# Back to Hub — Spoke App Snippet

Drop one of the snippets below into each Resonance spoke app
(`resonanceonline.life`, `resonancestudio.life`, `resonancesyncvision.life`,
`optimizer.resonance.life`, etc.) so users can always return to the hub
(`https://reson8.life`).

Place it in the app's top nav, near the logo / account menu.

## Hub URL

```ts
export const RESONANCE_HUB_URL = "https://reson8.life";
```

## React / Tailwind (matches hub styling)

```tsx
<a
  href="https://reson8.life"
  className="inline-flex items-center text-[11px] font-bold tracking-[0.15em] uppercase px-4 py-2 rounded-full border border-white/15 hover:border-white/40 transition-colors"
>
  ← Back to Hub
</a>
```

## Plain HTML (any framework)

```html
<a
  href="https://reson8.life"
  style="
    display:inline-flex;align-items:center;
    font:700 11px/1 system-ui,sans-serif;
    letter-spacing:.15em;text-transform:uppercase;
    padding:8px 16px;border-radius:9999px;
    border:1px solid rgba(255,255,255,.15);
    color:inherit;text-decoration:none;
  "
  onmouseover="this.style.borderColor='rgba(255,255,255,.4)'"
  onmouseout="this.style.borderColor='rgba(255,255,255,.15)'"
>
  ← Back to Hub
</a>
```

## Notes

- Always use the canonical hub URL `https://reson8.life` (not the
  `*.lovable.app` preview URLs) so the link survives domain changes.
- Open in the same tab (no `target="_blank"`) — this is a navigation back,
  not an outbound link.
- If the spoke uses light-themed chrome, swap `white` for `black` in the
  border / hover colors.
