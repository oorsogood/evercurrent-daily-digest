import { z } from 'zod';

export const RoleSchema = z.enum(['mechanical', 'supply-chain']);
export const RelationshipSchema = z.enum(['owner', 'follower']);
export const TopicSchema = z.enum(['design', 'testing', 'thermal', 'assembly', 'parts-supply', 'other']);
export const FocusSchema = z.enum(['design', 'validation', 'supply']);
export const PointTypeSchema = z.enum(['decision', 'risk', 'blocker', 'action', 'update']);
export const PointStatusSchema = z.enum(['open', 'resolved', 'needs-confirmation']);
export const LevelSchema = z.enum(['high', 'medium', 'low']);

export const MessageSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  timestamp: z.iso.datetime(),
  text: z.string(),
});
export const ThreadSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  channel: z.string(),
  messages: z.array(MessageSchema).min(1),
});
export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: RoleSchema,
  title: z.string(),
  relationships: z.record(z.string(), RelationshipSchema),
});
export const ProjectSchema = z.object({ id: z.string(), name: z.string() });
export const DatasetSchema = z.object({
  version: z.string(),
  date: z.iso.date(),
  timezone: z.string(),
  dayStart: z.iso.datetime(),
  cutoff: z.iso.datetime(),
  users: z.array(UserSchema).min(1),
  projects: z.array(ProjectSchema).min(1),
  threads: z.array(ThreadSchema).min(1),
});

/** Stage 1 model output. Identity, project, and timestamp are derived by the application, never by the model. */
export const ExtractedPointSchema = z.strictObject({
  summary: z.string(),
  type: PointTypeSchema,
  status: PointStatusSchema,
  topics: z.array(TopicSchema),
  relevantRoles: z.array(RoleSchema),
  assigneeIds: z.array(z.string()),
  dueDate: z.string().nullable(),
  messageIds: z.array(z.string()),
});
export const BriefOutputSchema = z.strictObject({ points: z.array(ExtractedPointSchema) });
export const PointSchema = ExtractedPointSchema.extend({
  id: z.string(),
  threadId: z.string(),
  projectId: z.string(),
  timestamp: z.iso.datetime(),
});
export const BriefSchema = z.object({
  threadId: z.string(),
  contentHash: z.string(),
  points: z.array(PointSchema),
  createdAt: z.string(),
});

export const FiltersSchema = z.strictObject({
  userId: z.string(),
  projectId: z.string(),
  /** Only meaningful when a single project is selected; null means the user's default relationship. */
  relationship: RelationshipSchema.nullable(),
  focus: FocusSchema,
});

export type Dataset = z.infer<typeof DatasetSchema>;
export type Thread = z.infer<typeof ThreadSchema>;
export type User = z.infer<typeof UserSchema>;
export type ExtractedPoint = z.infer<typeof ExtractedPointSchema>;
export type Point = z.infer<typeof PointSchema>;
export type Brief = z.infer<typeof BriefSchema>;
export type Filters = z.infer<typeof FiltersSchema>;
export type Focus = z.infer<typeof FocusSchema>;
export type Level = z.infer<typeof LevelSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
