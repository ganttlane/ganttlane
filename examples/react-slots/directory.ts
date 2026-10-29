import { createContext } from 'react';

import type { PersonId } from './data';

export interface Person {
  name: string;
  role: string;
  initials: string;
}

export type Directory = Record<PersonId, Person>;

/** Two teams: the same three ids, other people, so that a change of the provider is visible. */
export const TEAMS = {
  a: {
    ann: { name: 'Ann Lee', role: 'Designer', initials: 'AL' },
    bo: { name: 'Bo Chen', role: 'Backend engineer', initials: 'BC' },
    cy: { name: 'Cy Park', role: 'Frontend engineer', initials: 'CP' },
  },
  b: {
    ann: { name: 'Dee Ross', role: 'Design lead', initials: 'DR' },
    bo: { name: 'Eli Stone', role: 'Platform engineer', initials: 'ES' },
    cy: { name: 'Fay Moss', role: 'QA engineer', initials: 'FM' },
  },
} satisfies Record<string, Directory>;

/**
 * The application's own context: who the people are. The chart knows nothing about it, and the
 * slots read it, because React renders their content in the tree below the provider.
 */
export const DirectoryContext = createContext<Directory>(TEAMS.a);
