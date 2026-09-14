import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import type { Message } from '../types/shared';

// Issue #19552. `speak` parents a group member's answer to the SUPERVISOR's
// tool-use message, not to the tool result — so the member reply and the tool
// result are siblings, and the supervisor continues through the tool result.
// Branch resolution picks one continuation and the member's answer lost, which
// left it in `messageMap` but absent from the transcript the user reads.
//
// Every cell that asserts the reply is back pairs with the thing that must not
// change: the supervisor's own continuation still wins the branch, and nothing
// under the member is dragged across.
describe('parse — group member replies (#19552)', () => {
  const speakTurn = (): Message[] =>
    [
      {
        agentId: 'supervisor',
        content: 'user',
        createdAt: 1,
        id: 'user',
        parentId: null,
        role: 'user',
        updatedAt: 1,
      },
      {
        agentId: 'supervisor',
        content: 'supervisor-call',
        createdAt: 2,
        id: 'supervisor-call',
        parentId: 'user',
        role: 'assistant',
        tools: [
          {
            apiName: 'speak',
            arguments: '{"agentId":"member"}',
            id: 'call-speak',
            identifier: 'lobe-group-management',
            result_msg_id: 'tool-result',
            type: 'builtin',
          },
        ],
        updatedAt: 2,
      },
      {
        agentId: 'supervisor',
        content: 'Member started',
        createdAt: 3,
        id: 'tool-result',
        parentId: 'supervisor-call',
        role: 'tool',
        tool_call_id: 'call-speak',
        updatedAt: 3,
      },
      {
        agentId: 'member',
        content: 'MEMBER_REPLY',
        createdAt: 4,
        id: 'member-reply',
        metadata: { orchestrationRole: 'member' },
        parentId: 'supervisor-call',
        role: 'assistant',
        updatedAt: 4,
      },
      {
        agentId: 'supervisor',
        content: 'supervisor-followup',
        createdAt: 5,
        id: 'supervisor-followup',
        parentId: 'tool-result',
        role: 'assistant',
        updatedAt: 5,
      },
    ] as unknown as Message[];

  it('the member reply reaches the flatList', () => {
    const result = parse(speakTurn());

    // It was never missing from messageMap — that is what made the report hard
    // to place, and what this assertion pairs against.
    expect('member-reply' in result.messageMap).toBe(true);
    const reply = result.flatList.find((message) => message.id === 'member-reply');
    expect(reply).toBeDefined();
    expect(reply?.content).toBe('MEMBER_REPLY');
  });

  it('the supervisor still owns the continuation', () => {
    const result = parse(speakTurn());

    // The control. Recovering the member must not turn it into the branch the
    // conversation continues from: the supervisor's follow-up is still there,
    // and it is still inside the supervisor's own group rather than trailing
    // the member.
    const ids = result.flatList.map((message) => message.id);
    expect(ids).toContain('supervisor-call');
    expect(ids.indexOf('member-reply')).toBeGreaterThan(ids.indexOf('supervisor-call'));
    expect(JSON.stringify(result.flatList)).toContain('supervisor-followup');
  });

  it('a member reply already on the active branch is not duplicated', () => {
    // The recovery is keyed on "not already visible". A member that happens to
    // sit on the branch that wins must appear exactly once.
    const messages = [
      {
        agentId: 'supervisor',
        content: 'user',
        createdAt: 1,
        id: 'user',
        parentId: null,
        role: 'user',
        updatedAt: 1,
      },
      {
        agentId: 'member',
        content: 'MEMBER_REPLY',
        createdAt: 2,
        id: 'member-reply',
        metadata: { orchestrationRole: 'member' },
        parentId: 'user',
        role: 'assistant',
        updatedAt: 2,
      },
    ] as unknown as Message[];

    const occurrences = parse(messages).flatList.filter((message) => message.id === 'member-reply');
    expect(occurrences).toHaveLength(1);
  });

  it('an ordinary hidden assistant branch stays hidden', () => {
    // The scope control: this recovers group members, not every message branch
    // resolution decided against. A plain retried assistant answer must still
    // lose, or the transcript would show both sides of every regeneration.
    const messages = [
      {
        content: 'user',
        createdAt: 1,
        id: 'user',
        parentId: null,
        role: 'user',
        updatedAt: 1,
      },
      {
        content: 'RETRIED_ANSWER',
        createdAt: 2,
        id: 'retried',
        parentId: 'user',
        role: 'assistant',
        updatedAt: 2,
      },
      {
        content: 'kept',
        createdAt: 3,
        id: 'kept',
        parentId: 'user',
        role: 'assistant',
        updatedAt: 3,
      },
      {
        content: 'follow-up',
        createdAt: 4,
        id: 'follow-up',
        parentId: 'kept',
        role: 'user',
        updatedAt: 4,
      },
    ] as unknown as Message[];

    const ids = parse(messages).flatList.map((message) => message.id);
    expect(ids).toContain('kept');
    expect(ids).not.toContain('retried');
  });
});
