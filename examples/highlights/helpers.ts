/** What the controls of the example hold. */
export interface Settings {
  /** `display.nonWorkingDays`. */
  readonly nonWorkingDays: 'fill' | 'stripes' | false;
  /** `display.highlights`. */
  readonly highlights: boolean;
  /** Whether the Fridays rule is in the `highlights` list. */
  readonly fridays: boolean;
  /** `highlightTooltip.followCursor`. */
  readonly followCursor: boolean;
}

/**
 * Says which options the settings amount to, in the words of the options.
 *
 * @param settings - What the controls hold.
 * @returns A sentence.
 */
export function describe(settings: Settings): string {
  const ids = ['offsite', 'demo', 'freeze', ...(settings.fridays ? ['retro'] : [])].join(', ');
  const nonWorking = settings.nonWorkingDays === false ? 'false' : `'${settings.nonWorkingDays}'`;
  return `display: { nonWorkingDays: ${nonWorking}, highlights: ${String(settings.highlights)} }, highlightTooltip: { followCursor: ${String(settings.followCursor)} }, highlights: [${ids}]`;
}
