import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { defineCollection } from 'astro:content';

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),

  // The README of each example folder: the text of its page (`src/pages/examples/[slug].astro`).
  // The front matter is read by `examples/meta.ts` too (the sidebar), which checks the fields.
  examples: defineCollection({
    loader: glob({
      base: '../../examples',
      pattern: '*/README.md',
      generateId: ({ entry }) => entry.split('/')[0] ?? entry,
    }),
    schema: z.object({
      title: z.string(),
      description: z.string(),
      category: z.string(),
      order: z.number(),
      height: z.number().optional(),
      showsIssues: z.boolean().optional(),
    }),
  }),
};
