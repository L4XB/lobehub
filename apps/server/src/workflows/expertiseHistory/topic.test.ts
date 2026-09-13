// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runExpertiseHistoryTopicWorkflow } from './topic';

const ingestHistoricalTopic = vi.fn();

vi.mock('@/database/server', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/services/expertise/ingestion', () => ({
  ExpertiseIngestionService: class {
    ingestHistoricalTopic = ingestHistoricalTopic;
  },
}));

const context = {
  requestPayload: { agentId: 'agent_1', topicId: 'topic_1', userId: 'user_1' },
  run: (_name: string, fn: () => unknown) => fn(),
} as never;

/** Shape of the raw OpenAI SDK error the xAI endpoint throws when the account has no credits. */
const outOfCreditsError = () =>
  Object.assign(new Error('403 "You have run out of credits or need a Grok subscription."'), {
    status: 403,
  });

const skipped = { ingested: 0, reason: 'provider-account-error' };

afterEach(() => vi.clearAllMocks());

describe('runExpertiseHistoryTopicWorkflow', () => {
  it('finishes as a skip when the provider account is out of credits', async () => {
    ingestHistoricalTopic.mockRejectedValue(outOfCreditsError());

    await expect(runExpertiseHistoryTopicWorkflow(context)).resolves.toEqual(skipped);
  });

  it('finishes as a skip on a wrapped runtime quota error', async () => {
    ingestHistoricalTopic.mockRejectedValue({ errorType: 'InsufficientQuota' });

    await expect(runExpertiseHistoryTopicWorkflow(context)).resolves.toEqual(skipped);
  });

  it('keeps transient provider failures retryable', async () => {
    const overloaded = Object.assign(new Error('503 overloaded'), { status: 503 });
    ingestHistoricalTopic.mockRejectedValue(overloaded);

    await expect(runExpertiseHistoryTopicWorkflow(context)).rejects.toBe(overloaded);
  });

  it('returns the ingestion result on success', async () => {
    ingestHistoricalTopic.mockResolvedValue({ ingested: 1, reason: 'matched' });

    await expect(runExpertiseHistoryTopicWorkflow(context)).resolves.toEqual({
      ingested: 1,
      reason: 'matched',
    });
  });
});
