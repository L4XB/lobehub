import { AgentRuntimeErrorType } from '@lobechat/types';
import type { WorkflowContext } from '@upstash/workflow';

import { getServerDB } from '@/database/server';
import { ExpertiseIngestionService } from '@/server/services/expertise/ingestion';
import { runStep } from '@/server/workflows/step';

import type { ExpertiseHistoryTopicWorkflowPayload } from './types';

const ACCOUNT_ERROR_TYPES = new Set<string>([
  AgentRuntimeErrorType.AccountDeactivated,
  AgentRuntimeErrorType.InsufficientQuota,
  AgentRuntimeErrorType.InvalidProviderAPIKey,
  AgentRuntimeErrorType.NoAvailableProvider,
  AgentRuntimeErrorType.PermissionDenied,
]);
const ACCOUNT_ERROR_STATUSES = new Set([401, 402, 403]);

/**
 * Whether the provider refused the call because of the account behind it, not the request.
 *
 * Out of credits, a revoked key or a missing provider stays broken until the user acts, so a retry
 * only repeats the same refusal. Provider SDKs surface these either as a runtime `errorType` or,
 * when the body is not recognized (xAI's "run out of credits" 403), as a raw HTTP `status`.
 */
export const isProviderAccountError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const { errorType, status } = error as { errorType?: unknown; status?: unknown };

  return (
    (typeof errorType === 'string' && ACCOUNT_ERROR_TYPES.has(errorType)) ||
    (typeof status === 'number' && ACCOUNT_ERROR_STATUSES.has(status))
  );
};

export const runExpertiseHistoryTopicWorkflow = async (
  context: WorkflowContext<ExpertiseHistoryTopicWorkflowPayload>,
) => {
  const payload = context.requestPayload;
  return runStep(context, `expertise-history:topic:${payload.topicId}`, async () => {
    const db = await getServerDB();
    try {
      return await new ExpertiseIngestionService(
        db,
        payload.userId,
        payload.workspaceId,
      ).ingestHistoricalTopic(payload.agentId, payload.topicId);
    } catch (error) {
      // The user's own provider account is the problem, not this server: finish the run as a
      // skip instead of a 500, which Upstash would log as a server error and retry per topic.
      if (isProviderAccountError(error)) {
        return { ingested: 0, reason: 'provider-account-error' } as const;
      }
      throw error;
    }
  });
};
