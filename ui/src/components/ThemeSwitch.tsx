import { setTheme, useTheme, type Theme } from "../theme.js";

const CHOICES: readonly { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/*
 * A native radio group, not Base UI's: the sign-in pages download none of it. The choice is kept on this device and
 * nothing goes to the API.
 */
const FIELDSET = "m-0 flex flex-wrap gap-3 border-0 p-0";
const CHOICE =
  "flex cursor-pointer items-center gap-2 rounded-ward border border-ward-border-strong bg-ward-surface px-4 py-3 text-sm text-ward-text has-checked:border-ward-accent has-checked:bg-ward-surface-sunken";
const RADIO = "m-0 accent-ward-accent";

/** Light, Dark or System for the sign-in pages. The console is its own dark surface and ignores it. */
export function ThemeSwitch(): React.JSX.Element {
  const theme = useTheme();
  return (
    <fieldset className={FIELDSET}>
      <legend className="sr-only">Theme</legend>
      {CHOICES.map((choice) => (
        <label key={choice.value} className={CHOICE}>
          <input
            type="radio"
            name="theme"
            value={choice.value}
            checked={theme === choice.value}
            className={RADIO}
            onChange={() => {
              setTheme(choice.value);
            }}
          />
          {choice.label}
        </label>
      ))}
    </fieldset>
  );
}
