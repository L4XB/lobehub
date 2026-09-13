import { and, ne, or, sql } from 'drizzle-orm';

import { messages } from '../schemas';
import { SEARCHABLE_TEXT_SQL_PATTERN } from './searchableText';

/** Shared source eligibility for message search, candidates, and ES projection. */
export const searchableMessage = () =>
  and(
    ne(messages.role, 'tool'),
    or(
      sql`coalesce(${messages.content} ~ ${sql.raw(SEARCHABLE_TEXT_SQL_PATTERN)}, false)`,
      sql`coalesce(${messages.summary} ~ ${sql.raw(SEARCHABLE_TEXT_SQL_PATTERN)}, false)`,
    ),
  )!;
