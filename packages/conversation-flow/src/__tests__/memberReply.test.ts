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

// Two shapes the first pass of this recovery got wrong, both raised in review
// on #19566. Each is a member the transcript ALREADY accounts for, or one the
// user deliberately navigated away from — recovering either puts an answer on
// screen that should not be there.
describe('parse — members the recovery must leave alone', () => {
  it('a council member already embedded in the supervisor block is not appended again', () => {
    // A broadcast turn: the council tool carries the members inside the
    // supervisor's bubble, so they never appear at top level. Reading
    // visibility off the top-level ids alone made every broadcast answer
    // render twice.
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
        agentId: 'supervisor',
        content: 'broadcast',
        createdAt: 2,
        id: 'supervisor-call',
        parentId: 'user',
        role: 'assistant',
        tools: [
          {
            apiName: 'broadcast',
            arguments: '{}',
            id: 'call-broadcast',
            identifier: 'lobe-group-management',
            result_msg_id: 'council-tool',
            type: 'builtin',
          },
        ],
        updatedAt: 2,
      },
      {
        agentId: 'supervisor',
        content: 'Council started',
        createdAt: 3,
        id: 'council-tool',
        metadata: { agentCouncil: true },
        parentId: 'supervisor-call',
        role: 'tool',
        tool_call_id: 'call-broadcast',
        updatedAt: 3,
      },
      {
        agentId: 'member-a',
        content: 'MEMBER_A',
        createdAt: 4,
        id: 'member-a',
        metadata: { orchestrationRole: 'member' },
        parentId: 'supervisor-call',
        role: 'assistant',
        updatedAt: 4,
      },
      {
        agentId: 'member-b',
        content: 'MEMBER_B',
        createdAt: 5,
        id: 'member-b',
        metadata: { orchestrationRole: 'member' },
        parentId: 'supervisor-call',
        role: 'assistant',
        updatedAt: 5,
      },
    ] as unknown as Message[];

    const result = parse(messages);

    expect(result.flatList.filter((message) => message.id === 'member-a')).toHaveLength(0);
    expect(result.flatList.filter((message) => message.id === 'member-b')).toHaveLength(0);
  });

  it('a member under a branch the user navigated away from stays hidden', () => {
    // The supervisor's tool-use message was regenerated. The old shell and its
    // member lost branch resolution together; resurrecting the member alone
    // puts an abandoned answer back into the transcript and into the context
    // the next request is built from.
    const messages = [
      {
        agentId: 'supervisor',
        // The regeneration is the branch the user is on.
        content: 'user',
        createdAt: 1,
        id: 'user',
        metadata: { activeBranchIndex: 1 },
        parentId: null,
        role: 'user',
        updatedAt: 1,
      },
      {
        agentId: 'supervisor',
        content: 'first attempt',
        createdAt: 2,
        id: 'supervisor-call-old',
        parentId: 'user',
        role: 'assistant',
        tools: [
          {
            apiName: 'speak',
            arguments: '{"agentId":"member"}',
            id: 'call-old',
            identifier: 'lobe-group-management',
            result_msg_id: 'tool-result-old',
            type: 'builtin',
          },
        ],
        updatedAt: 2,
      },
      {
        agentId: 'supervisor',
        content: 'Member started',
        createdAt: 3,
        id: 'tool-result-old',
        parentId: 'supervisor-call-old',
        role: 'tool',
        tool_call_id: 'call-old',
        updatedAt: 3,
      },
      {
        agentId: 'member',
        content: 'ABANDONED_MEMBER_REPLY',
        createdAt: 4,
        id: 'member-reply-old',
        metadata: { orchestrationRole: 'member' },
        parentId: 'supervisor-call-old',
        role: 'assistant',
        updatedAt: 4,
      },
      {
        agentId: 'supervisor',
        content: 'second attempt',
        createdAt: 5,
        id: 'supervisor-call-new',
        parentId: 'user',
        role: 'assistant',
        updatedAt: 5,
      },
    ] as unknown as Message[];

    const result = parse(messages);
    const rendered = result.flatList.map((message) => message.id);

    // The regeneration wins the branch, as it must.
    expect(rendered).toContain('supervisor-call-new');
    expect(rendered).not.toContain('supervisor-call-old');
    // And the member that belonged to the abandoned shell goes with it.
    expect(rendered).not.toContain('member-reply-old');
  });
});
