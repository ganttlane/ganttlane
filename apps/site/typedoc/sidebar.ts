import type { StarlightPlugin } from '@astrojs/starlight/types';

/** The label of the sidebar group the TypeDoc groups are put in (`astro.config.ts`). */
const API_GROUP = 'API reference';

/** The part of a sidebar group this module needs: its label and its items. */
interface Group {
  label: string;
  items: unknown[];
  collapsed?: boolean;
}

function isGroup(item: unknown): item is Group {
  return (
    typeof item === 'object' &&
    item !== null &&
    'label' in item &&
    typeof item.label === 'string' &&
    'items' in item &&
    Array.isArray(item.items)
  );
}

/** The URL of the page of a module group: `@ganttlane/dom/facade` is `/api/ganttlane/dom/facade/`. */
function modulePage(label: string): string | undefined {
  const match = /^@ganttlane\/(.+)$/.exec(label);
  return match?.[1] === undefined ? undefined : `/api/ganttlane/${match[1]}/`;
}

/** Closes the `References` groups (the re-exports) so that a package's own exports lead. */
function collapseReferences(group: Group): Group {
  return {
    ...group,
    ...(group.label === 'References' ? { collapsed: true } : {}),
    items: group.items.map((item) => (isGroup(item) ? collapseReferences(item) : item)),
  };
}

/**
 * Finishes the sidebar group `starlight-typedoc` generates (it must run after that plugin): the
 * hand-written overview page leads the group, each package's page leads its own group (the
 * generator lists only the pages of its members), and the long lists of re-exports start closed.
 *
 * @returns The Starlight plugin.
 */
export function apiSidebar(): StarlightPlugin {
  return {
    name: 'ganttlane-api-sidebar',
    hooks: {
      'config:setup': ({ config, updateConfig }) => {
        // The sidebar is typed as the union of every kind of item; this reads only groups.
        const sidebar: unknown[] = config.sidebar ?? [];
        const finished = sidebar.map((item) => {
          if (!isGroup(item) || item.label !== API_GROUP) return item;
          return {
            ...item,
            items: [
              { slug: 'api', label: 'Overview' },
              ...item.items.map((entry) => {
                if (!isGroup(entry)) return entry;
                const page = modulePage(entry.label);
                const group = collapseReferences(entry);
                return page === undefined
                  ? group
                  : { ...group, items: [{ label: 'Overview', link: page }, ...group.items] };
              }),
            ],
          };
        });
        updateConfig({ sidebar: finished as NonNullable<typeof config.sidebar> });
      },
    },
  };
}
