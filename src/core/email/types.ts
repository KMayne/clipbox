/**
 * Email (.eml) values, and the display model the preview reads (validated with Zod, since it
 * arrives from the worker). No heavy imports: the UI loads this file too.
 */

import { z } from 'zod';
import type { AuthResult } from './auth';
import type { Address, Header, MailDate } from './headers';
import type { MimePart } from './mime';
import type { Hop } from './received';

/** A part shown as a file: an attachment, an inline image or a forwarded message. */
export interface EmailAttachment {
  /** Index into `EmailValue.parts`. */
  part: number;
  /** Its own file name, else one made from its type (a forwarded message's from its subject). */
  name: string;
  mime: string;
  size: number;
  contentId: string | null;
  /** Shown inside the HTML body (a `cid:` image it references), not as a separate file. */
  inline: boolean;
}

export interface EmailValue {
  kind: 'email';
  size: number;
  headers: Header[];
  subject: string | null;
  from: Address[];
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  date: MailDate | null;
  /** The Date header as written. */
  dateRaw: string | null;
  messageId: string | null;
  parts: MimePart[];
  /** Index of the part chosen as the HTML body, if any. */
  htmlPart: number | null;
  /** Index of the part chosen as the plain-text body, if any. */
  textPart: number | null;
  attachments: EmailAttachment[];
  auth: AuthResult[];
  received: Hop[];
  /** Limits reached or malformed structure, for the Info section. */
  warnings: string[];
}

/** The `json` slice: what the preview shows besides the body. */
export interface EmailLayout {
  subject: string | null;
  from: string;
  to: string;
  cc: string;
  replyTo: string;
  /** Formatted in the sender's offset, else as written. */
  date: string | null;
  body: 'html' | 'text' | 'none';
  /** Remote images left out of the HTML body. */
  blockedImages: number;
  attachments: Omit<EmailAttachment, 'part' | 'contentId'>[];
  auth: { method: string; result: string; text: string }[];
}

export const emailLayoutSchema: z.ZodType<EmailLayout> = z.object({
  subject: z.string().nullable(),
  from: z.string(),
  to: z.string(),
  cc: z.string(),
  replyTo: z.string(),
  date: z.string().nullable(),
  body: z.enum(['html', 'text', 'none']),
  blockedImages: z.number(),
  attachments: z.array(
    z.object({ name: z.string(), mime: z.string(), size: z.number(), inline: z.boolean() }),
  ),
  auth: z.array(z.object({ method: z.string(), result: z.string(), text: z.string() })),
});

/** A derivation id opening attachment `i` (an index into `EmailValue.attachments`). */
export const ATTACHMENT_PREFIX = 'attachment:';
