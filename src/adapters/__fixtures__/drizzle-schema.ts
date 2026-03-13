// Drizzle ORM schema fixture — used by adapters.test.ts
// Note: drizzle-orm is not installed; ts-morph parses this as AST without resolving imports
import { pgTable, serial, varchar, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: text('email').notNull().unique(),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at'),
});

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  content: text('content'),
  authorId: integer('author_id').notNull().references(() => users.id),
});

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
});
