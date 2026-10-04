import { BriefOutputSchema, type Dataset, type Point, type Thread, type User } from './schema';

export class InvalidOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOutputError';
  }
}

const NON_ENGLISH = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]/;
export const containsNonEnglish = (text: string) => NON_ENGLISH.test(text);

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the text states the date explicitly: ISO, "Oct 2", or "October 2". */
export function mentionsDate(text: string, isoDate: string): boolean {
  if (text.includes(isoDate)) return true;
  const [, month, day] = isoDate.split('-').map(Number);
  const name = MONTHS[(month ?? 0) - 1];
  if (!name || !day) return false;
  return new RegExp(`\\b(${name}|${name.slice(0, 3)})\\.? ${day}\\b`).test(text);
}

export function mentionsUser(text: string, user: User): boolean {
  const first = user.name.split(' ')[0]!;
  return (
    text.includes(user.name) ||
    text.includes(`@${user.id}`) ||
    new RegExp(`\\b${escape(first)}\\b`).test(text)
  );
}

export const MAX_POINTS_PER_THREAD = 3;
export const MAX_SUMMARY_CHARS = 280;
export const MAX_SENTENCE_CHARS = 240;

/** Stage 1 trust boundary: structure, citations, assignees, deadlines, and language. Accuracy still needs evaluation. */
export function validateBrief(value: unknown, thread: Thread, dataset: Dataset): Point[] {
  const parsed = BriefOutputSchema.safeParse(value);
  if (!parsed.success) throw new InvalidOutputError('The response did not match the brief schema.');
  if (parsed.data.points.length > MAX_POINTS_PER_THREAD)
    throw new InvalidOutputError(`Return at most ${MAX_POINTS_PER_THREAD} points.`);
  return parsed.data.points.map((point, index) => {
    const summary = point.summary.trim();
    if (!summary || summary.length > MAX_SUMMARY_CHARS)
      throw new InvalidOutputError(`A summary is empty or longer than ${MAX_SUMMARY_CHARS} characters.`);
    if (containsNonEnglish(summary)) throw new InvalidOutputError('Summaries must be written in English.');
    if (!point.messageIds.length) throw new InvalidOutputError('Every point must cite at least one message.');
    const cited = point.messageIds.map((id) => {
      const message = thread.messages.find((m) => m.id === id);
      if (!message) throw new InvalidOutputError(`Message ${id} is not part of this thread.`);
      return message;
    });
    const citedText = cited.map((m) => m.text).join('\n');
    for (const id of point.assigneeIds) {
      const user = dataset.users.find((u) => u.id === id);
      if (!user) throw new InvalidOutputError(`Assignee ${id} is not a known user.`);
      if (!mentionsUser(citedText, user))
        throw new InvalidOutputError(`Assignee ${id} is not named in the cited messages.`);
    }
    if (point.dueDate !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(point.dueDate) || Number.isNaN(Date.parse(point.dueDate)))
        throw new InvalidOutputError('Due dates must use YYYY-MM-DD.');
      if (!mentionsDate(citedText, point.dueDate))
        throw new InvalidOutputError(`Due date ${point.dueDate} is not stated in the cited messages.`);
    }
    return {
      ...point,
      summary,
      topics: [...new Set(point.topics)],
      relevantRoles: [...new Set(point.relevantRoles)],
      assigneeIds: [...new Set(point.assigneeIds)],
      messageIds: [...new Set(point.messageIds)],
      id: `${thread.id}:${index + 1}`,
      threadId: thread.id,
      projectId: thread.projectId,
      timestamp: cited
        .map((m) => m.timestamp)
        .sort()
        .at(-1)!,
    };
  });
}

export interface WriterItem {
  ref: string;
  facts: string;
}

/**
 * Stage 2 trust boundary. Expects exactly one "P<n> | sentence" line per item, in order.
 * Every number in a sentence must already appear in that item's facts, so the writer cannot invent figures or dates.
 */
export function parseDigestLines(text: string, items: readonly WriterItem[]): string[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length !== items.length)
    throw new InvalidOutputError(`Expected ${items.length} lines, received ${lines.length}.`);
  return lines.map((line, index) => {
    const item = items[index]!;
    const match = /^(P\d+)\s*\|\s*(.+)$/.exec(line);
    if (!match || match[1] !== item.ref)
      throw new InvalidOutputError(`Line ${index + 1} must start with "${item.ref} |".`);
    const sentence = match[2]!.trim();
    if (!sentence || sentence.length > MAX_SENTENCE_CHARS)
      throw new InvalidOutputError(`${item.ref} is empty or longer than ${MAX_SENTENCE_CHARS} characters.`);
    if (containsNonEnglish(sentence)) throw new InvalidOutputError(`${item.ref} must be written in English.`);
    for (const number of sentence.match(/\d+(?:\.\d+)?/g) ?? []) {
      if (!item.facts.includes(number))
        throw new InvalidOutputError(`${item.ref} contains "${number}", which is not in its source facts.`);
    }
    return sentence;
  });
}
