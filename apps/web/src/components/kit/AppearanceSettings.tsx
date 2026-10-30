/**
 * The Appearance section of Settings, shared by the dashboard and the Ops
 * console: design, light or dark, layout, spacing and the Halloween
 * costume. Every choice applies at once and is remembered in this browser
 * (components/kit/theme.ts). Real radio buttons and a checkbox, so it
 * works with the keyboard and a screen reader.
 */
import { DESIGNS, useAppearance, type Density, type Design, type Layout, type Mode } from "./theme.js";
import { useCostume } from "./Halloween.js";

/** Each design's own colours, for its preview (light mode). */
const PREVIEW: Record<Design, { page: string; side: string; band: string; pill: string; art: [string, string, string] }> = {
  carnival: { page: "#eceafb", side: "#1f2672", band: "#1f2672", pill: "#ffb42e", art: ["#ffb42e", "#ff3d68", "#07c983"] },
  blush: { page: "#f6e3df", side: "#fbeee9", band: "#151314", pill: "#f2c6c2", art: ["#e6c49b", "#e6a596", "#f2c6c2"] },
  slate: { page: "#e6eaf1", side: "#2f3d5c", band: "#2f3d5c", pill: "#ff6b6b", art: ["#ff6b6b", "#6cb6ff", "#ffd27a"] },
};

const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "Match my device" },
];

const LAYOUTS: ReadonlyArray<{ id: Layout; label: string; hint: string }> = [
  { id: "sidebar", label: "Sidebar", hint: "Navigation down the left side." },
  { id: "topbar", label: "Top bar", hint: "Navigation across the top; pages use the full width." },
];

const DENSITIES: ReadonlyArray<{ id: Density; label: string; hint: string }> = [
  { id: "comfortable", label: "Comfortable", hint: "More room around everything." },
  { id: "compact", label: "Compact", hint: "Tighter spacing, more rows on screen." },
];

function DesignPreview({ design }: { design: Design }) {
  const c = PREVIEW[design];
  return (
    <svg className="fp-settings-preview" viewBox="0 0 120 72" aria-hidden focusable={false}>
      <rect width="120" height="72" fill={c.page} />
      <rect width="30" height="72" fill={c.side} />
      <rect x="5" y="16" width="20" height="5" rx="2.5" fill={c.pill} />
      <rect x="38" y="8" width="74" height="30" rx="6" fill={c.band} />
      <circle cx="98" cy="23" r="9" fill={c.art[0]} />
      <path d="M86 32l7-7 7 7z" fill={c.art[1]} />
      <rect x="44" y="27" width="22" height="6" rx="3" fill={c.pill} />
      <rect x="38" y="44" width="22" height="20" rx="4" fill={c.art[2]} opacity="0.6" />
      <rect x="64" y="44" width="22" height="20" rx="4" fill={c.art[0]} opacity="0.45" />
      <rect x="90" y="44" width="22" height="20" rx="4" fill={c.art[1]} opacity="0.4" />
    </svg>
  );
}

function LayoutPreview({ layout }: { layout: Layout }) {
  return (
    <svg className="fp-settings-preview fp-settings-preview-wire" viewBox="0 0 120 72" aria-hidden focusable={false}>
      <rect width="120" height="72" rx="4" className="wire-page" />
      {layout === "sidebar" ? (
        <>
          <rect width="28" height="72" className="wire-bar" />
          <rect x="36" y="10" width="76" height="22" rx="4" className="wire-block" />
          <rect x="36" y="38" width="76" height="26" rx="4" className="wire-block" />
        </>
      ) : (
        <>
          <rect width="120" height="14" className="wire-bar" />
          <rect x="8" y="22" width="104" height="18" rx="4" className="wire-block" />
          <rect x="8" y="46" width="104" height="20" rx="4" className="wire-block" />
        </>
      )}
    </svg>
  );
}

export function AppearanceSettings() {
  const { appearance, update } = useAppearance();
  const { on: costume, toggle: toggleCostume } = useCostume();

  return (
    <div className="fp-settings">
      <fieldset className="fp-settings-group">
        <legend>Design</legend>
        <p className="fp-settings-hint">Colours, type and shapes for the whole app.</p>
        <div className="fp-settings-cards">
          {DESIGNS.map((d) => (
            <label key={d.id} className="fp-settings-card">
              <input
                type="radio"
                name="fp-design"
                value={d.id}
                checked={appearance.design === d.id}
                onChange={() => update({ design: d.id })}
              />
              <DesignPreview design={d.id} />
              <span className="fp-settings-card-name">{d.name}</span>
              <span className="fp-settings-card-text">{d.description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="fp-settings-group">
        <legend>Light or dark</legend>
        <div className="fp-segment fp-settings-segment">
          {MODES.map((m) => (
            <label key={m.id}>
              <input type="radio" name="fp-mode" value={m.id} checked={appearance.mode === m.id} onChange={() => update({ mode: m.id })} />
              <span>{m.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="fp-settings-group">
        <legend>Layout</legend>
        <div className="fp-settings-cards fp-settings-cards-2">
          {LAYOUTS.map((l) => (
            <label key={l.id} className="fp-settings-card">
              <input type="radio" name="fp-layout" value={l.id} checked={appearance.layout === l.id} onChange={() => update({ layout: l.id })} />
              <LayoutPreview layout={l.id} />
              <span className="fp-settings-card-name">{l.label}</span>
              <span className="fp-settings-card-text">{l.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="fp-settings-group">
        <legend>Spacing</legend>
        <div className="fp-settings-options">
          {DENSITIES.map((d) => (
            <label key={d.id} className="fp-settings-option">
              <input type="radio" name="fp-density" value={d.id} checked={appearance.density === d.id} onChange={() => update({ density: d.id })} />
              <span>
                <span className="fp-settings-card-name">{d.label}</span>
                <span className="fp-settings-card-text">{d.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="fp-settings-group">
        <legend>Halloween</legend>
        <label className="fp-settings-option">
          <input type="checkbox" checked={costume} onChange={() => toggleCostume()} />
          <span>
            <span className="fp-settings-card-name">Halloween costume</span>
            <span className="fp-settings-card-text">A haunted night over any design: bats, a ghost, a graveyard. Also on the pumpkin button.</span>
          </span>
        </label>
      </fieldset>

      <p className="fp-settings-saved">These choices are saved in this browser and apply straight away.</p>
    </div>
  );
}
