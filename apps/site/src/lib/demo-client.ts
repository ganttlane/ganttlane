import { isMode, type Mode, MODE_EVENT } from './demo-mode';
import { addExampleCss } from './example-css';
import { syncSiteTheme } from './theme-sync';

/**
 * The client side of `<Demo>`: the Vanilla / React toggle, and the vanilla example, mounted in the
 * browser only. (The React example is the island `ReactDemo.tsx`, which listens to the same
 * toggle.) Every `vanilla.ts` of `examples/` is a module of its own that is loaded when its demo
 * needs it: `mount(container)` draws the chart and returns the clean-up.
 */
type Mount = (container: HTMLElement) => () => void;
const vanilla = import.meta.glob<{ mount: Mount }>('../../../../examples/*/vanilla.ts');

const MODE_KEY = 'ganttlane:demo-mode';

function savedMode(): Mode | undefined {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return isMode(value) ? value : undefined;
  } catch {
    return undefined; // storage may be blocked: the toggle works without it
  }
}

function saveMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // not remembered
  }
}

function setUp(demo: HTMLElement): void {
  const slug = demo.dataset.slug ?? '';
  const pane = demo.querySelector<HTMLElement>('[data-pane="vanilla"]');
  const buttons = [...demo.querySelectorAll<HTMLButtonElement>('[data-mode-button]')];
  const modes = [...demo.querySelectorAll<HTMLElement>('[data-pane]')]
    .map((element) => element.dataset.pane)
    .filter(isMode);

  let cleanUp: (() => void) | undefined;
  let stopTheme: (() => void) | undefined;
  let removeCss: (() => void) | undefined;
  let generation = 0;

  const stopVanilla = (): void => {
    generation++;
    stopTheme?.();
    cleanUp?.();
    removeCss?.();
    cleanUp = stopTheme = removeCss = undefined;
  };

  const startVanilla = async (): Promise<void> => {
    const mine = ++generation;
    const load = vanilla[`../../../../examples/${slug}/vanilla.ts`];
    if (!pane || !load) return;
    const [{ mount }, remove] = await Promise.all([load(), addExampleCss(slug)]);
    // The mode may have changed while the module was loading.
    if (mine !== generation) {
      remove();
      return;
    }
    removeCss = remove;
    stopTheme = syncSiteTheme(pane);
    cleanUp = mount(pane);
  };

  const show = (mode: Mode): void => {
    demo.dataset.mode = mode;
    for (const element of demo.querySelectorAll<HTMLElement>('[data-pane]')) {
      element.hidden = element.dataset.pane !== mode;
    }
    for (const button of buttons) {
      button.setAttribute('aria-selected', String(button.dataset.modeButton === mode));
    }
    if (mode === 'vanilla') void startVanilla();
    else stopVanilla();
    demo.dispatchEvent(new CustomEvent<Mode>(MODE_EVENT, { detail: mode }));
  };

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const mode = button.dataset.modeButton;
      if (!isMode(mode) || mode === demo.dataset.mode) return;
      saveMode(mode);
      show(mode);
    });
  }

  // The one the visitor chose last time, when this example has it.
  const remembered = savedMode();
  const first = remembered && modes.includes(remembered) ? remembered : demo.dataset.mode;
  if (isMode(first)) show(first);
}

for (const demo of document.querySelectorAll<HTMLElement>('[data-demo]')) setUp(demo);
