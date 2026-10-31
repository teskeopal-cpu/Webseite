import { pgTable, text, bigint, jsonb, timestamp } from 'drizzle-orm/pg-core';
export const passkeys = pgTable('quiz_passkeys', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull(),
  transports: jsonb('transports').$type<string[]>().notNull(),
  userId: text('user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const challenges = pgTable('quiz_passkey_challenges', {
  id: text('id').primaryKey(),
  challenge: text('challenge').notNull(),
  kind: text('kind').notNull(),
  userId: text('user_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
