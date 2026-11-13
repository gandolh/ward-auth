import { setTheme, useTheme, type Theme } from "../theme.js";

const CHOICES: readonly { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/*
 * A native radio group, not Base UI's: the sign-in pages download none of it. The choice is kept on this device and
 * nothing goes to the API.
 *
 * One segmented row, capped near 360 px above the phone width: each radio covers its whole segment (so the segment is
 * the click target and the arrow keys move the choice as they do in any radio group), and is invisible, so the
 * segment draws what the radio's state is. The checked segment is the one place a public page uses accent-soft, with
 * accent text and a 1 px accent edge, and the focus ring is drawn on the segment, where the eye is.
 */
const FIELDSET =
  "m-0 mt-4 flex max-w-[22.5rem] min-w-0 gap-1 rounded-lg border border-ward-border-strong bg-ward-surface-sunken p-1 max-sm:max-w-none";
const CHOICE = "relative min-w-0 flex-1";
const RADIO = "peer absolute inset-0 m-0 size-full cursor-pointer opacity-0";
const FACE =
  "flex min-h-11 items-center justify-center rounded-ward border border-transparent text-sm font-medium text-ward-text-muted peer-checked:border-ward-accent peer-checked:bg-ward-accent-soft peer-checked:font-semibold peer-checked:text-ward-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ward-focus max-sm:min-h-12";

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
          <span className={FACE}>{choice.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
