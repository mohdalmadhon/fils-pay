import { AppearanceSettings } from "../../components/kit/AppearanceSettings.js";

/** Settings: how the dashboard looks for this person, in this browser. */
export function SettingsPage() {
  return (
    <section>
      <h1>Settings</h1>
      <p className="dash-muted fp-settings-intro">Choose how FilsPay looks for you. Changes apply straight away.</p>
      <AppearanceSettings />
    </section>
  );
}
