/**
 * Central input validation and sanitization for all backend routes.
 *
 * Uses Zod for schema validation and provides:
 * - Shared primitive schemas (email, name, phone, IDs, enums, etc.)
 * - Route-specific schemas for every mutating endpoint
 * - validate() Express middleware factory
 * - sanitizeWebhookBody() for lenient webhook payload cleaning
 * - stripHtmlTags() XSS helper
 */

import { z, ZodSchema, ZodError } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { DEAL_ASSOCIATION_TYPES, DEFAULT_PIPELINE_SLUG, PIPELINE_STATUS_TYPES } from '../types/constants.js';

export const workspacePermissionsSchema = z.object({
  deals: z.enum(['none', 'view', 'edit']),
  deals_scope: z.enum(['assigned_only', 'all']).optional().default('assigned_only'),
  pipelines: z.union([z.literal('all'), z.array(z.string())]).optional().default('all'),
  conversations: z.enum(['none', 'view', 'reply']),
}).strict();

export const updateWorkspacePermissionsSchema = z.object({ permissions: workspacePermissionsSchema }).strict();

export const instagramOAuthCompleteSchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(1).max(4096),
}).strict();

export const instagramReplySchema = z.object({
  text: z.string().trim().min(1).max(1000).transform(value => value.replace(/<[^>]*>/g, '')).pipe(z.string().trim().min(1)),
}).strict();

export const whatsAppSignupCompleteSchema = z.object({
  code: z.string().min(1).max(4096), state: z.string().min(1).max(4096),
  waba_id: z.string().regex(/^\d+$/).max(64), phone_number_id: z.string().regex(/^\d+$/).max(64),
}).strict();

export const whatsAppPhoneRegistrationSchema = z.object({ pin: z.string().regex(/^\d{6}$/) }).strict();

export const whatsAppMetaTemplateSchema = z.object({
  name: z.string().trim().min(1).max(512).regex(/^[a-z0-9_]+$/),
  language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/).max(10),
  category: z.enum(['UTILITY', 'MARKETING']),
  body: z.string().trim().min(1).max(1024).transform(stripHtmlTags).pipe(z.string().trim().min(1)),
  examples: z.array(z.string().trim().min(1).max(200).transform(stripHtmlTags).pipe(z.string().trim().min(1))).max(10).default([]),
}).strict().superRefine((value, context) => {
  const variables = [...new Set(Array.from(value.body.matchAll(/\{\{(\d+)\}\}/g), match => Number(match[1])))].sort((a, b) => a - b);
  const leftover = value.body.replace(/\{\{\d+\}\}/g, '');
  if (leftover.includes('{{') || leftover.includes('}}') || variables.some((number, index) => number !== index + 1) || variables.length !== value.examples.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['examples'], message: 'Use consecutive variables {{1}}, {{2}}, etc. and one sample value per variable.' });
  }
});

// ============ SANITIZATION HELPERS ============

/**
 * Strip HTML tags from a string to prevent stored XSS.
 * Deliberately simple — React escapes JSX output by default,
 * but raw API consumers could be vulnerable.
 */
export function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}

// ============ SHARED PRIMITIVES ============

/** Positive integer (for IDs) */
export const positiveInt = z.coerce.number().int().positive();

/** Workspace ID — coerces strings to numbers, must be positive int */
export const workspaceIdSchema = z.coerce
  .number()
  .int()
  .positive({ message: 'workspace_id must be a positive integer' });

export const workspaceCurrencySchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.enum(['INR', 'USD', 'AED', 'EUR', 'GBP', 'SGD', 'AUD', 'CAD', 'SAR', 'QAR']));

/** Email: trimmed, lowercased, max 254, format-validated */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254, 'Email must be at most 254 characters')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address');

/** Optional email — empty string or valid email */
export const optionalEmailSchema = z
  .union([
    z.literal(''),
    z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  ])
  .optional();

/** Name: trimmed, max 200, HTML stripped */
export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(200, 'Name must be at most 200 characters')
  .transform(stripHtmlTags);

/** Optional name */
export const optionalNameSchema = z
  .string()
  .trim()
  .max(200)
  .transform(stripHtmlTags)
  .optional();

/** Password: min 8, max 128 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

/** Phone: trimmed, max 20, optional */
export const phoneSchema = z
  .union([z.literal(''), z.string().trim().max(20)])
  .optional();

/** Short text with configurable max length, HTML stripped */
export const shortText = (maxLen: number = 100) =>
  z.string().trim().max(maxLen).transform(stripHtmlTags);

/** Long text with configurable max length, HTML stripped */
export const longText = (maxLen: number = 5000) =>
  z.string().trim().max(maxLen).transform(stripHtmlTags);

/** Hex color: #RGB, #RRGGBB, or #RRGGBBAA */
export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{3,8}$/, 'Invalid hex color')
  .optional();

/** Slug format: alphanumeric + underscores + hyphens */
export const slugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(100, 'Slug must be at most 100 characters')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Slug must contain only letters, numbers, hyphens, and underscores'
  );

/** Flag integer: 0 or 1 */
export const flagInt = z.coerce.number().int().min(0).max(1);

/** Optional date string (ISO or YYYY-MM-DD HH:mm:ss) */
export const optionalDateString = z
  .union([z.literal(''), z.string().trim().max(30)])
  .optional();

// ============ ENUM SCHEMAS ============

/** Custom field types — from CustomField.field_type */
export const customFieldTypeEnum = z.enum([
  'text',
  'number',
  'date',
  'checkbox',
  'select',
  'multiselect',
  'textarea',
]);

/** Workspace stage IDs are validated against saved stages in the deal route. */
export const dealStageSlug = z.string().trim().regex(/^[a-z][a-z0-9_]{0,59}$/, 'Invalid stage');

export const updateDealStagesSchema = z.object({
  workspace_id: workspaceIdSchema,
  pipeline_slug: z.string().trim().max(100).optional(),
  stages: z.array(z.object({
    slug: dealStageSlug,
    name: z.string().trim().min(1).max(80).transform(stripHtmlTags).pipe(z.string().min(1)),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid stage color'),
    counts_as_conversion: z.boolean(),
    status_type: z.enum(PIPELINE_STATUS_TYPES).optional(),
  }).strict()).min(1).max(30),
});

const dealFieldId = z.string().regex(/^df_[a-zA-Z0-9_-]{1,64}$/, 'Invalid deal field ID');
export const dealCustomFieldsSchema = z.array(z.object({
  id: dealFieldId,
  label: z.string().trim().min(1).max(80).transform(stripHtmlTags).pipe(z.string().trim().min(1)),
  type: z.enum(['text', 'textarea', 'number', 'date', 'email', 'phone', 'select']),
  options: z.array(z.string().trim().min(1).max(120).transform(stripHtmlTags).pipe(z.string().trim().min(1))).max(50).default([]),
  required_in_stages: z.array(dealStageSlug).max(30).default([]),
  archived: z.boolean().default(false),
}).strict()).max(50).superRefine((fields, ctx) => {
  if (new Set(fields.map((field) => field.id)).size !== fields.length ||
      new Set(fields.map((field) => field.label.toLowerCase())).size !== fields.length) {
    ctx.addIssue({ code: 'custom', message: 'Deal field names and IDs must be unique' });
  }
  for (const field of fields) {
    if (field.type === 'select' && !field.options.length) ctx.addIssue({ code: 'custom', message: `${field.label} needs at least one option` });
    if (new Set(field.options).size !== field.options.length) ctx.addIssue({ code: 'custom', message: `${field.label} has duplicate options` });
    if (new Set(field.required_in_stages).size !== field.required_in_stages.length) ctx.addIssue({ code: 'custom', message: `${field.label} has duplicate stages` });
  }
});

export const updateDealConfigurationSchema = updateDealStagesSchema.extend({
  fields: dealCustomFieldsSchema,
  required_documents: z.array(z.string().trim().min(1).max(60).transform(stripHtmlTags).pipe(z.string().trim().min(1).max(60)).transform((kind) => kind.toLowerCase())).max(20).default([]),
}).strict().superRefine((config, ctx) => {
  const slugs = new Set(config.stages.map((stage) => stage.slug));
  for (const field of config.fields) {
    if (field.required_in_stages.some((slug) => !slugs.has(slug))) {
      ctx.addIssue({ code: 'custom', message: `${field.label} references a stage outside this workspace configuration` });
    }
  }
});

const dealFieldValuesSchema = z.record(dealFieldId, z.string().max(4000).transform(stripHtmlTags).transform((value) => value.trim()))
  .refine((values) => Object.keys(values).length <= 50, 'Too many deal field values');

export const selectProspectSchema = z.object({
  workspace_id: workspaceIdSchema,
  selected: z.boolean(),
}).strict();

/** Priority */
export const priorityEnum = z.enum(['low', 'medium', 'high']);

/** Lead status type — from LeadStatus.type */
export const statusTypeEnum = z.enum(['open', 'closed', 'won', 'lost']);

/** Member role */
export const memberRoleEnum = z.enum(['admin', 'manager', 'member', 'viewer']);

// ============ AUTH SCHEMAS ============

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});

export const signupSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  accepted_terms: flagInt.refine((v) => v === 1, {
    message: 'You must accept the Terms of Service to continue',
  }),
  accepted_terms_at: z.string().trim().min(1, 'accepted_terms_at is required').max(50),
});

// ============ LEAD SCHEMAS ============

export const createLeadSchema = z
  .object({
    workspace_id: workspaceIdSchema,
    name: optionalNameSchema,
    email: optionalEmailSchema,
    phone: phoneSchema,
    source_old: z.string().trim().max(100).optional(),
    source: z.string().trim().max(100).optional(),
    source_ref: z.string().trim().max(200).optional(),
    source_id: z.string().trim().max(200).optional(),
    status_id: z.coerce.number().int().positive().optional(),
  })
  .passthrough(); // Allow custom field keys

export const updateLeadSchema = z
  .object({
    workspace_id: workspaceIdSchema.optional(),
    status_id: z.coerce.number().int().positive().optional().nullable(),
    name: optionalNameSchema,
    email: optionalEmailSchema,
    phone: phoneSchema,
    source_old: z.string().trim().max(100).optional(),
    source_ref: z.string().trim().max(200).optional(),
    source_id: z.string().trim().max(200).optional(),
    email_valid: flagInt.optional(),
    phone_valid: flagInt.optional(),
    email_verified_at: z.string().trim().max(30).optional(),
    email_verification_status: z
      .enum(['valid', 'invalid', 'disposable', 'spamtrap'])
      .optional(),
    deleted_at: z.string().trim().max(30).optional().nullable(),
    user_id: z.coerce.number().int().positive().optional().nullable(),
  })
  .passthrough(); // Allow custom field keys

export const bulkImportSchema = z.object({
  workspace_id: workspaceIdSchema,
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, 'rows must be a non-empty array')
    .max(5000, 'rows exceeds limit (5000)'),
  mode: z.enum(['create', 'upsert_email']).default('create'),
  verify_emails: z.boolean().optional().default(false),
  concurrency: z.coerce.number().int().min(1).max(5).optional().default(2),
});

// ============ DEAL SCHEMAS ============

export const dealTagsSchema = z
  .array(z.string().trim().min(1).max(50).transform(stripHtmlTags).pipe(z.string().trim().min(1).max(50)))
  .max(50);

export const createDealSchema = z.object({
  custom_fields: dealFieldValuesSchema.optional(),
  workspace_id: workspaceIdSchema,
  name: nameSchema,
  value: z.coerce.number().min(0, 'value must be a non-negative number').default(0),
  contact: z
    .string()
    .trim()
    .max(200)
    .transform(stripHtmlTags)
    .optional()
    .default(''),
  owner_id: z.coerce.number().int().positive().optional().nullable(),
  stage: dealStageSlug.optional(),
  pipeline_slug: z.string().trim().max(100).default('default'),
  expected_close_date: optionalDateString.nullable(),
  priority: priorityEnum.optional().nullable(),
  lead_id: z.coerce.number().int().positive().optional(),
  tags: dealTagsSchema.optional(),
});

export const updateDealSchema = z
  .object({
    custom_fields: dealFieldValuesSchema.optional(),
    name: z.string().trim().max(200).transform(stripHtmlTags).optional(),
    value: z.coerce.number().min(0).optional(),
    contact: z.string().trim().max(200).transform(stripHtmlTags).optional(),
    owner_id: z.coerce.number().int().positive().optional().nullable(),
    stage: dealStageSlug.optional(),
    pipeline_slug: z.string().trim().max(100).optional(),
    expected_close_date: optionalDateString.nullable(),
    priority: priorityEnum.optional().nullable(),
    tags: dealTagsSchema.optional(),
  })
  .passthrough();

export const createPipelineSchema = z.object({
  workspace_id: workspaceIdSchema,
  name: nameSchema,
});

export const updatePipelineSchema = z.object({
  workspace_id: workspaceIdSchema,
  name: nameSchema,
}).strict();

export const dealDocumentUploadSchema = z.object({
  name: z.string().trim().min(1).max(200).transform(stripHtmlTags).pipe(z.string().trim().min(1).max(200)),
  kind: z.string().trim().min(1).max(60).transform(stripHtmlTags).pipe(z.string().trim().min(1).max(60)),
  mime: z.string().trim().min(1).max(100),
  size: z.coerce.number().int().min(1).max(10 * 1024 * 1024),
  data: z.string().min(1).max(14_000_000).regex(/^[A-Za-z0-9+/=]+$/, 'Invalid file data'),
}).strict();

export const createDealAssociationSchema = z.object({
  workspace_id: workspaceIdSchema,
  source_deal_id: z.coerce.number().int().positive(),
  target_deal_id: z.coerce.number().int().positive(),
  type: z.enum(DEAL_ASSOCIATION_TYPES).optional().default(DEAL_ASSOCIATION_TYPES[0]),
}).strict().refine((data) => data.source_deal_id !== data.target_deal_id, {
  message: 'source and target must differ',
  path: ['target_deal_id'],
});

const webFormFieldKeySchema = z
  .string()
  .trim()
  .min(1, 'Field key is required')
  .max(120)
  .regex(/^[A-Za-z0-9_.\-]+$/, 'Invalid field key');

export const webFormDealMappingSchema = z.object({
  workspace_id: workspaceIdSchema,
  source_id: z.string().trim().min(1).max(180),
  enabled: z.boolean().default(false),
  pipeline_slug: z.string().trim().max(100).default(DEFAULT_PIPELINE_SLUG),
  stage: dealStageSlug,
  owner_user_id: z.coerce.number().int().positive().nullable().default(null),
  fields: z.object({
    name: webFormFieldKeySchema.optional(),
    contact: webFormFieldKeySchema.optional(),
    value: webFormFieldKeySchema.optional(),
    priority: webFormFieldKeySchema.optional(),
    expected_close_date: webFormFieldKeySchema.optional(),
  }).strict().default({}),
  deal_custom_fields: z
    .record(z.string().regex(/^df_[a-zA-Z0-9_-]{1,64}$/, 'Invalid deal field ID'), webFormFieldKeySchema)
    .default({}),
}).strict();

export const updateCustomerProfileSchema = z.object({
  workspace_id: workspaceIdSchema,
  email: optionalEmailSchema,
  phone: shortText(30).optional(),
  address: longText(1000).default(''),
  custom_fields: z.array(z.object({
    label: shortText(80).pipe(z.string().min(1, 'Field name is required')),
    value: longText(2000),
  })).max(30).default([]).refine(
    (fields) => new Set(fields.map((field) => field.label.toLowerCase())).size === fields.length,
    'Custom field names must be unique',
  ),
  order_items: z.record(z.string().regex(/^\d+$/), z.array(z.object({
    name: shortText(200).pipe(z.string().min(1, 'Item name is required')),
    quantity: z.coerce.number().int().positive().max(100000),
  })).max(100)).default({}),
}).refine(
  (profile) => Buffer.byteLength(JSON.stringify(profile), 'utf8') <= 60000,
  'Customer profile is too large',
);

// ============ WORKSPACE SCHEMAS ============

export const createWorkspaceSchema = z.preprocess((input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const obj = input as Record<string, unknown>;
  const rawName = obj.name;
  if (typeof rawName === 'string' && rawName.trim()) return obj;

  const legacyName =
    typeof obj.workspaceName === 'string'
      ? obj.workspaceName
      : typeof obj.workspace_name === 'string'
        ? obj.workspace_name
        : undefined;

  if (typeof legacyName === 'string') {
    return { ...obj, name: legacyName };
  }

  return obj;
},
z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Workspace name must be at least 2 characters')
      .max(50, 'Workspace name must be less than 50 characters')
      .transform(stripHtmlTags),
    owner_id: z.coerce.number().int().positive(),
    currency: workspaceCurrencySchema.optional().default('INR'),
  })
  .passthrough()); // Allow created_at, description, etc.

export const updateWorkspaceSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Workspace name must be at least 2 characters')
      .max(50, 'Workspace name must be less than 50 characters')
      .transform(stripHtmlTags)
      .optional(),
    currency: workspaceCurrencySchema.optional(),
  })
  .strict()
  .refine((data) => data.name !== undefined || data.currency !== undefined, {
    message: 'At least one workspace field is required',
  });

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: memberRoleEnum.optional(),
});

export const createWorkspaceMemberSchema = z.object({
  workspace_id: workspaceIdSchema,
  user_id: z.coerce.number().int().positive(),
  role: z.enum(['owner', 'admin', 'manager', 'member', 'viewer']),
  created_at: z.string().trim().max(30).optional(),
});

export const updateMemberSchema = z.object({
  workspace_id: workspaceIdSchema,
  role: memberRoleEnum,
});

// ============ CUSTOM FIELD SCHEMAS ============

export const createCustomFieldSchema = z.object({
  label: shortText(100).pipe(z.string().min(1, 'Label is required')),
  slug: slugSchema,
  field_type: customFieldTypeEnum.default('text'),
  options: z.string().trim().max(2000).optional().nullable(),
  is_required: flagInt.optional().default(0),
  is_active: flagInt.optional().default(1),
  sort_order: z.coerce.number().int().min(0).max(1000).optional().default(0),
});

export const updateCustomFieldSchema = z.object({
  workspace_id: workspaceIdSchema,
  label: shortText(100).optional(),
  slug: slugSchema.optional(),
  field_type: customFieldTypeEnum.optional(),
  options: z.string().trim().max(2000).optional().nullable(),
  is_required: flagInt.optional(),
  is_active: flagInt.optional(),
  sort_order: z.coerce.number().int().min(0).max(1000).optional(),
});

export const createCustomFieldValueSchema = z.object({
  lead_id: z.coerce.number().int().positive(),
  field_id: z.coerce.number().int().positive(),
  value: z.string().max(10000).transform(stripHtmlTags),
});

export const updateCustomFieldValueSchema = z.object({
  value: z.string().max(10000).transform(stripHtmlTags).optional(),
  lead_id: z.coerce.number().int().positive().optional(),
  field_id: z.coerce.number().int().positive().optional(),
});

// ============ LEAD STATUS SCHEMAS ============

export const createLeadStatusSchema = z.object({
  workspace_id: workspaceIdSchema,
  name: shortText(50).pipe(z.string().min(1, 'Name is required')),
  slug: slugSchema,
  color: hexColorSchema.default('#6B7280'),
  type: statusTypeEnum.default('open'),
  is_default: flagInt.optional().default(0),
  is_active: flagInt.optional().default(1),
  order_index: z.coerce.number().int().min(0).max(1000).optional().default(0),
  is_qualified: flagInt.optional().default(0),
});

export const updateLeadStatusSchema = z
  .object({
    workspace_id: workspaceIdSchema.optional(),
    name: shortText(50).optional(),
    slug: slugSchema.optional(),
    color: hexColorSchema,
    type: statusTypeEnum.optional(),
    is_default: flagInt.optional(),
    is_active: flagInt.optional(),
    order_index: z.coerce.number().int().min(0).max(1000).optional(),
    is_qualified: flagInt.optional(),
  })
  .passthrough();

// ============ ACTIVITY SCHEMAS ============

export const createActivitySchema = z.object({
  lead_id: z.coerce.number().int().positive(),
  workspace_id: workspaceIdSchema,
  user_id: z.coerce.number().int().positive(),
  type: z.string().trim().max(50),
  title: shortText(200),
  description: longText(5000),
  metadata: z
    .union([z.string().max(10000), z.record(z.string(), z.unknown())])
    .optional(),
  created_at: z.string().max(30).optional(),
});

export const updateActivitySchema = z.object({
  title: shortText(200).optional(),
  description: longText(5000).optional(),
  metadata: z
    .union([z.string().max(10000), z.record(z.string(), z.unknown())])
    .optional(),
});

// ============ WHATSAPP SCHEMAS ============

export const whatsAppTriggerKindEnum = z.enum([
  'new_lead',
  'hello_world',
  'call_no_answer',
  'lead_done',
  'bulk_marketing',
]);

export const upsertWhatsAppConfigSchema = z.object({
  enabled: z.boolean().optional(),
  phone_number_id: z.string().trim().max(100).optional(),
  waba_id: z.string().trim().max(100).optional(),
  access_token: z.string().max(2000).optional(),
  display_phone: z.string().trim().max(30).optional(),
});

export const upsertWhatsAppTriggerSchema = z.object({
  new_lead: z.boolean().optional(),
  call_no_answer: z.boolean().optional(),
  lead_done: z.boolean().optional(),
  done_status_ids: z.array(z.coerce.number().int().positive()).optional(),
  done_status_types: z
    .array(z.enum(['won', 'closed', 'lost', 'open']))
    .optional(),
  no_answer_cooldown_hours: z.coerce.number().int().min(1).max(168).optional(),
});

export const upsertWhatsAppTemplateSchema = z.object({
  enabled: z.boolean().optional(),
  meta_template_name: z.string().trim().max(200).optional(),
  language: z.string().trim().max(20).optional(),
  body: z.string().trim().max(5000).optional(),
  meta_approved: z.boolean().optional(),
});

export const whatsAppTestMessageSchema = z.object({
  to_phone: z.string().trim().min(1, 'Phone number is required').max(20),
  trigger_kind: whatsAppTriggerKindEnum.optional(),
  use_plain_text: z.boolean().optional(),
  use_sandbox_template: z.boolean().optional(),
  message_body: z.string().trim().max(1000).optional(),
});

export const whatsAppResendSchema = z.object({
  trigger_kind: whatsAppTriggerKindEnum.default('new_lead'),
});

export const createWhatsAppCampaignSchema = z.object({
  name: shortText(200),
  template_kind: whatsAppTriggerKindEnum.default('bulk_marketing'),
  lead_ids: z.array(z.coerce.number().int().positive()).max(500).optional(),
  status_ids: z.array(z.coerce.number().int().positive()).optional(),
  source_filter: z.string().trim().max(100).optional(),
});

// ============ MIDDLEWARE FACTORY ============

/**
 * Format a ZodError into a user-friendly structure matching AuthErrorResponse.
 */
function formatZodError(error: ZodError): {
  summary: string;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    if (!fieldErrors[path]) {
      fieldErrors[path] = issue.message;
    }
  }
  const firstIssue = error.issues[0];
  const summary = firstIssue
    ? `${firstIssue.path.length > 0 ? firstIssue.path.join('.') : 'Input'}: ${firstIssue.message}`
    : 'Validation failed';
  return { summary, fieldErrors };
}

/**
 * Express middleware that validates req.body against a Zod schema.
 * On success, replaces req.body with the parsed (sanitized, trimmed, defaulted) output.
 * On failure, returns 400 with structured error details.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      res.status(400).json({
        success: false,
        status: 'error',
        error: formatted.summary,
        details: formatted.fieldErrors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

// ============ WEBHOOK SANITIZER ============

/**
 * Sanitize webhook body fields in-place.
 * Does NOT reject the request — logs warnings for bad data and cleans up values.
 * This preserves backward compatibility with external integrations.
 */
export function sanitizeWebhookBody(body: Record<string, any>): {
  warnings: string[];
} {
  const warnings: string[] = [];
  const KNOWN_FIELDS = new Set([
    'name',
    'full_name',
    'first_name',
    'last_name',
    'email',
    'phone',
  ]);

  // Sanitize name fields (max 200 chars, strip HTML)
  for (const key of ['name', 'full_name', 'first_name', 'last_name']) {
    if (typeof body[key] === 'string') {
      const original = body[key];
      body[key] = stripHtmlTags(body[key]).slice(0, 200);
      if (body[key] !== original) {
        warnings.push(`${key} was sanitized`);
      }
    }
  }

  // Sanitize email (max 254 chars, trim, lowercase)
  if (typeof body.email === 'string') {
    body.email = body.email.trim().toLowerCase().slice(0, 254);
  }

  // Sanitize phone (max 20 chars)
  if (typeof body.phone === 'string') {
    body.phone = body.phone.trim().slice(0, 20);
  }

  // Sanitize remaining string values (max 10000 chars, strip HTML)
  for (const [key, value] of Object.entries(body)) {
    if (KNOWN_FIELDS.has(key)) continue;
    if (typeof value === 'string') {
      let sanitized = value;
      if (sanitized.length > 10000) {
        sanitized = sanitized.slice(0, 10000);
        warnings.push(`${key} was truncated to 10000 characters`);
      }
      const stripped = stripHtmlTags(sanitized);
      if (stripped !== sanitized) {
        warnings.push(`${key} had HTML tags stripped`);
        sanitized = stripped;
      }
      if (sanitized !== value) {
        body[key] = sanitized;
      }
    }
  }

  return { warnings };
}


export const aiChatSchema = z.object({
  session_id: z.string().trim().max(128).optional(),
  workspace_id: z.coerce.number().int().positive(),
  message: z.string().trim().min(1).max(4000).transform(stripHtmlTags),
  history: z.array(z.object({
    id: z.string().max(128).optional(),
    role: z.enum(['user', 'model', 'assistant', 'system', 'tool']),
    content: z.string().max(10000),
    tool_name: z.string().max(128).optional(),
    tool_call_id: z.string().max(128).optional(),
    timestamp: z.string().max(64).optional(),
  })).max(50).optional().default([]),
}).strict();

export const aiConfirmActionSchema = z.object({
  ticket_id: z.string().trim().min(1).max(256),
  confirmed: z.boolean(),
}).strict();

export const createMcpTokenSchema = z.object({
  name: z.string().trim().min(1).max(100).transform(stripHtmlTags),
}).strict();
