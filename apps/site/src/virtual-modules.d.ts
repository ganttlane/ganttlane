/**
 * `virtual:example-css`, made by `integrations/example-styles.ts`: the stylesheets each mode of
 * each example imports, as functions that load their text (`?inline`), in import order.
 */
declare module 'virtual:example-css' {
  const sheets: Readonly<
    Record<
      string,
      Readonly<
        Partial<Record<'vanilla' | 'react', readonly (() => Promise<{ default: string }>)[]>>
      >
    >
  >;
  export default sheets;
}
