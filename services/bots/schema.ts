import { z } from 'zod';
import { BLOCK_TYPES, HANDLER_TYPES, MAX_SCRIPT_BYTES } from './constants.js';

const handlerSchema: z.ZodType<{ handler: (typeof HANDLER_TYPES)[number]; params: Record<string, unknown> }> = z.lazy(() =>
  z.object({
    handler: z.enum(HANDLER_TYPES),
    params: z.record(z.string(), z.unknown()).default({}),
  })
);

const stepSchema = z.object({
  question: z.array(handlerSchema).max(100).default([]),
  answer: z.array(handlerSchema).max(100).default([]),
  finish: z.array(handlerSchema).max(100).default([]),
});

export const scriptSchema = z
  .array(stepSchema)
  .max(200)
  .superRefine((steps, ctx) => {
    if (Buffer.byteLength(JSON.stringify(steps), 'utf8') > MAX_SCRIPT_BYTES) {
      ctx.addIssue({ code: 'custom', message: `Script exceeds ${MAX_SCRIPT_BYTES} bytes` });
    }
    steps.forEach((step, index) => {
      for (const block of BLOCK_TYPES) {
        step[block].forEach((entry, handlerIndex) => {
          if (entry.handler !== 'goto') return;
          const params = entry.params as Record<string, unknown>;
          const target = Number(params.step);
          if (!Number.isInteger(target) || target < 0 || target >= steps.length) {
            ctx.addIssue({
              code: 'custom',
              path: [index, block, handlerIndex, 'params', 'step'],
              message: `goto step must be between 0 and ${Math.max(0, steps.length - 1)}`,
            });
          }
          if (params.block !== undefined && !(BLOCK_TYPES as readonly string[]).includes(String(params.block))) {
            ctx.addIssue({
              code: 'custom',
              path: [index, block, handlerIndex, 'params', 'block'],
              message: 'goto block is not valid',
            });
          }
        });
      }
    });
  });

export type ParsedScript = z.infer<typeof scriptSchema>;
