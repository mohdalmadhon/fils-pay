import { AppearanceSettings } from "../../components/kit/AppearanceSettings.js";

/** Settings: how the Ops console looks for this person, in this browser. */
export function SettingsPage() {
  return (
    <section>
      <h1>Settings</h1>
      <p className="admin-muted fp-settings-intro">Choose how the Ops console looks for you. Changes apply straight away.</p>
      <AppearanceSettings />
    </section>
  );
}
